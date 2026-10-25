import { EventEmitter } from 'node:events';
import { createDb, type Db, type DomainContext, type Restaurant } from './core';
import { cockpitDb, COLLECTIONS, migrateCockpitDb, yumcoDbEnabled } from './db';
import { fetchYumcoRestaurants, profileOf, yumcoIdOf, type RestaurantProfile } from './yumcoRestaurants';
import { config } from './config';

type Table = (typeof COLLECTIONS)[number] | 'restaurant_profiles' | 'app_state';
const keyColumn = (table: Table) => (table === 'app_state' ? 'key' : table === 'restaurant_profiles' ? 'yumco_restaurant_id' : 'id');

/**
 * Base en mémoire, chargée depuis PostgreSQL au démarrage. Toute écriture passe par `mutate`, qui incrémente
 * la version, planifie l'enregistrement en base (seuls les éléments modifiés sont écrits) et notifie les abonnés SSE.
 * Les restaurants viennent de la base Yumco ; seul leur profil cockpit est enregistré.
 */
class Store extends EventEmitter {
  private db: Db = createDb();
  private version = 0;
  private saveTimer: NodeJS.Timeout | null = null;
  private saving: Promise<void> = Promise.resolve();
  /** Contenu déjà en base (JSON de chaque ligne, par table) : on n'écrit que ce qui a changé. */
  private persisted = new Map<Table, Map<string, string>>();
  /** Profils lus au démarrage, pour les restaurants pas encore relus dans la base Yumco. */
  private profiles = new Map<number, RestaurantProfile>();

  constructor() {
    super();
    this.setMaxListeners(100);
  }

  get snapshot(): Db {
    return this.db;
  }

  get currentVersion() {
    return this.version;
  }

  /** Crée les tables si besoin et charge les données ; base vide : agents, projets et réglages par défaut. */
  async init() {
    await migrateCockpitDb();
    const db = cockpitDb();
    const state = new Map((await db.query<{ key: string; data: unknown }>('select key, data from app_state')).rows.map((r) => [r.key, r.data]));
    if (!state.has('settings')) {
      console.log('[store] base du cockpit vide : initialisation (agents, projets, réglages).');
      this.db = createDb();
      await this.save();
      return;
    }
    const loaded = createDb();
    for (const name of COLLECTIONS) {
      const { rows } = await db.query<{ id: string; data: never }>(`select id, data from ${name}`);
      const order = (state.get(`order:${name}`) as string[] | undefined) ?? [];
      const rank = new Map(order.map((id, i) => [id, i]));
      loaded[name] = rows.sort((a, b) => (rank.get(a.id) ?? order.length) - (rank.get(b.id) ?? order.length)).map((r) => r.data);
    }
    loaded.settings = state.get('settings') as Db['settings'];
    if (state.has('finance')) loaded.finance = state.get('finance') as Db['finance'];
    const { rows: profiles } = await db.query<{ yumco_restaurant_id: number; data: RestaurantProfile }>('select yumco_restaurant_id, data from restaurant_profiles');
    this.profiles = new Map(profiles.map((p) => [p.yumco_restaurant_id, p.data]));

    // Une génération en cours lors d'un arrêt du serveur ne reprendra pas.
    loaded.drafts.forEach((d) => {
      d.versions
        .filter((v) => v.status === 'generating')
        .forEach((v) => Object.assign(v, { status: 'failed', error: 'Génération interrompue par un redémarrage du serveur. Relancez-la.' }));
      d.builds
        .filter((b) => b.status === 'building' || b.status === 'testing')
        .forEach((b) => Object.assign(b, { status: 'failed', error: 'Développement interrompu par un redémarrage du serveur. Relancez-le.' }));
    });
    this.db = loaded;
    this.persisted = this.rows();
    this.persisted.set('restaurant_profiles', new Map(profiles.map((p) => [String(p.yumco_restaurant_id), JSON.stringify(p.data)])));
    console.log(`[store] données chargées depuis la base du cockpit (${loaded.drafts.length} dossier(s), ${loaded.tasks.length} tâche(s), ${this.profiles.size} profil(s) de restaurant)`);
    // Les dossiers interrompus ci-dessus sont enregistrés.
    this.changed();
  }

  /** Exécute une fonction métier sur la base et propage le changement. */
  mutate<T>(fn: (ctx: DomainContext) => T): T {
    const result = fn(this.context());
    this.changed();
    return result;
  }

  /** Relit les restaurants dans la base Yumco (les profils cockpit sont conservés). */
  async refreshRestaurants() {
    if (!yumcoDbEnabled()) return;
    try {
      const current = new Map(this.db.restaurants.map((r) => [r.id, r]));
      const list = await fetchYumcoRestaurants((id) => {
        const known = current.get(`yumco-${id}`);
        return known ? profileOf(known) : this.profiles.get(id);
      });
      if (JSON.stringify(list) === JSON.stringify(this.db.restaurants)) return;
      this.db.restaurants = list;
      this.changed();
    } catch (err) {
      console.error('[store] lecture des restaurants Yumco impossible :', (err as Error).message);
    }
  }

  startRestaurantSync() {
    if (!yumcoDbEnabled()) {
      console.warn('[store] YUMCO_DATABASE_URL absente : aucun restaurant affiché.');
      return;
    }
    setInterval(() => void this.refreshRestaurants(), config.restaurantsRefreshMs).unref();
  }

  /** Écriture immédiate (arrêt du serveur). */
  async flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    await this.save();
  }

  private context(): DomainContext {
    return {
      db: this.db,
      schedule: (ms, fn) => {
        setTimeout(() => {
          fn(this.db);
          this.changed();
        }, ms).unref();
      },
    };
  }

  private changed() {
    this.version += 1;
    this.emit('change', this.version);
    this.scheduleSave(300);
  }

  private scheduleSave(ms: number) {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, ms);
  }

  /** Lignes de chaque table pour l'état actuel. */
  private rows() {
    const out = new Map<Table, Map<string, string>>();
    for (const name of COLLECTIONS) out.set(name, new Map((this.db[name] as { id: string }[]).map((x) => [x.id, JSON.stringify(x)])));
    out.set(
      'restaurant_profiles',
      new Map(
        this.db.restaurants.flatMap((r: Restaurant): [string, string][] => {
          const id = yumcoIdOf(r.id);
          return id === null ? [] : [[String(id), JSON.stringify(profileOf(r))]];
        }),
      ),
    );
    out.set(
      'app_state',
      new Map([
        ['settings', JSON.stringify(this.db.settings)],
        ['finance', JSON.stringify(this.db.finance)],
        ...COLLECTIONS.map((name): [string, string] => [`order:${name}`, JSON.stringify((this.db[name] as { id: string }[]).map((x) => x.id))]),
      ]),
    );
    return out;
  }

  /** Les écritures se suivent : une seule transaction à la fois. En cas d'échec, nouvel essai 5 s plus tard. */
  private save() {
    this.saving = this.saving
      .then(() => this.write())
      .catch((err) => {
        console.error('[store] enregistrement en base impossible, nouvel essai dans 5 s :', (err as Error).message);
        if (!this.saveTimer) this.scheduleSave(5000);
      });
    return this.saving;
  }

  private async write() {
    const next = this.rows();
    const writes: { table: Table; id: string; json: string | null }[] = [];
    for (const [table, items] of next) {
      const prev = this.persisted.get(table) ?? new Map<string, string>();
      for (const [id, json] of items) if (prev.get(id) !== json) writes.push({ table, id, json });
      // Un restaurant absent de la base Yumco garde son profil (il peut revenir).
      if (table !== 'restaurant_profiles') for (const id of prev.keys()) if (!items.has(id)) writes.push({ table, id, json: null });
    }
    if (!writes.length) return;
    const client = await cockpitDb().connect();
    try {
      await client.query('begin');
      for (const w of writes) {
        const col = keyColumn(w.table);
        const key = w.table === 'restaurant_profiles' ? Number(w.id) : w.id;
        if (w.json === null) await client.query(`delete from ${w.table} where ${col} = $1`, [key]);
        else
          await client.query(
            `insert into ${w.table} (${col}, data, updated_at) values ($1, $2, now()) on conflict (${col}) do update set data = excluded.data, updated_at = now()`,
            [key, w.json],
          );
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    for (const [table, items] of next) {
      const kept = table === 'restaurant_profiles' ? new Map([...(this.persisted.get(table) ?? []), ...items]) : items;
      this.persisted.set(table, kept);
    }
  }
}

export const store = new Store();

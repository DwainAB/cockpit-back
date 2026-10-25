import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { createDb, type DayKey, type Db, type DomainContext, type OpeningHours, type QuestionnaireAnswers, type SiteDraft, type TimeSlot } from './core';
import { config } from './config';

/** À incrémenter quand la forme des données change : un ancien fichier est alors ignoré. */
const SCHEMA_VERSION = 7;

/**
 * Base en mémoire. Toute écriture passe par `mutate`, qui incrémente la version,
 * planifie la sauvegarde JSON et notifie les abonnés SSE.
 */
class Store extends EventEmitter {
  private db: Db;
  private version = 0;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.setMaxListeners(100);
    this.db = this.load() ?? createDb();
  }

  get snapshot(): Db {
    return this.db;
  }

  get currentVersion() {
    return this.version;
  }

  /** Exécute une fonction métier sur la base et propage le changement. */
  mutate<T>(fn: (ctx: DomainContext) => T): T {
    const result = fn(this.context());
    this.changed();
    return result;
  }

  reset() {
    this.db = createDb();
    this.changed();
  }

  /** Écriture immédiate (arrêt du serveur). */
  flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.save();
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
    if (!config.persist) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 300);
  }

  private load(): Db | null {
    if (!config.persist || !fs.existsSync(config.dataFile)) return null;
    try {
      const { schemaVersion, ...data } = JSON.parse(fs.readFileSync(config.dataFile, 'utf8')) as Db & { schemaVersion?: number };
      // v4 → v5 : les restaurants fictifs disparaissent ; les maquettes créées sont conservées.
      if (schemaVersion === 4) {
        console.log('[store] migration v4 → v5 : maquettes conservées, données de démonstration réinitialisées.');
        return { ...createDb(), drafts: data.drafts };
      }
      // v5 → v6 : développement du site (builds) et adresse de la plateforme sur chaque maquette.
      if (schemaVersion === 5) {
        console.log('[store] migration v5 → v6 : ajout du développement des sites.');
        data.drafts = data.drafts.map((d) => ({ ...d, builds: d.builds ?? [], platformUrl: d.platformUrl ?? config.platformUrl }));
      }
      // v6 → v7 : questionnaire complet (adresse détaillée, gérant, services, livraison) et offre Yumco.
      if (schemaVersion === 5 || schemaVersion === 6) {
        console.log('[store] migration v6 → v7 : questionnaire complet et offre Yumco.');
        data.drafts = data.drafts.map(upgradeDraftV7);
        return { ...data, typing: {} };
      }
      if (schemaVersion !== SCHEMA_VERSION) {
        console.warn(`[store] fichier au format ${schemaVersion ?? 1} (attendu ${SCHEMA_VERSION}) : nouvelles données de démo utilisées.`);
        return null;
      }
      console.log(`[store] données chargées depuis ${config.dataFile}`);
      // Une génération en cours lors d'un arrêt du serveur ne reprendra pas.
      data.drafts.forEach((d) => {
        d.versions
          .filter((v) => v.status === 'generating')
          .forEach((v) => Object.assign(v, { status: 'failed', error: 'Génération interrompue par un redémarrage du serveur. Relancez-la.' }));
        d.builds
          .filter((b) => b.status === 'building' || b.status === 'testing')
          .forEach((b) => Object.assign(b, { status: 'failed', error: 'Développement interrompu par un redémarrage du serveur. Relancez-le.' }));
      });
      return { ...data, typing: {} };
    } catch (err) {
      console.warn(`[store] fichier illisible, nouvelles données de démo utilisées : ${(err as Error).message}`);
      return null;
    }
  }

  private save() {
    if (!config.persist) return;
    const { typing: _typing, ...data } = this.db;
    fs.mkdirSync(path.dirname(config.dataFile), { recursive: true });
    const tmp = `${config.dataFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...data }, null, 2));
    fs.renameSync(tmp, config.dataFile);
  }
}

/** Ancien questionnaire (adresse en un champ, créneaux libres, pas de gérant) → format v7. */
const upgradeDraftV7 = (draft: SiteDraft): SiteDraft => {
  const old = draft.answers as unknown as Omit<QuestionnaireAnswers, 'address' | 'hours'> & {
    address: string;
    hours: Record<DayKey, { closed: boolean; slots: TimeSlot[] }>;
  };
  const [street = old.address, rest = ''] = old.address.split(/,(.*)/s).map((part) => part.trim());
  const place = /(\d{5})\s+([^,]+)/.exec(rest);
  const hours = Object.fromEntries(
    Object.entries(old.hours).map(([day, h]) => {
      const lunch = h.slots.find((slot) => slot.open < '16:00') ?? null;
      const dinner = h.slots.find((slot) => slot.open >= '16:00') ?? null;
      return [day, { closed: h.closed || (!lunch && !dinner), lunch: h.closed ? null : lunch, dinner: h.closed ? null : dinner }];
    }),
  ) as OpeningHours;
  const answers: QuestionnaireAnswers = {
    ...old,
    address: { street, postalCode: place?.[1] ?? '', city: place?.[2]?.trim() ?? rest, country: 'France' },
    hours,
    googleReviewUrl: '',
    manager: { firstName: '', lastName: '', email: old.email, phone: old.phone },
    onsite: { enabled: true, tables: 0, seatsPerTable: 4 },
    pickup: old.onlineOrdering,
    preparationTime: 30,
    delivery: { enabled: false, lunch: true, dinner: true, maxKm: 5, zones: [] },
    menu: { aLaCarte: true, allYouCanEat: false, formulas: [] },
    wantsOnlinePayment: false,
  };
  return { ...draft, answers, plan: draft.plan ?? 'starter', source: draft.source ?? 'cockpit', yumcoRestaurantId: draft.yumcoRestaurantId ?? null };
};

export const store = new Store();

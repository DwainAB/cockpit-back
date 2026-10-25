/** Connexions PostgreSQL : base du cockpit (lecture et écriture) et base Yumco (lecture seule). */
import pg from 'pg';
import { config } from './config';

let cockpit: pg.Pool | null = null;
let yumco: pg.Pool | null = null;

export const cockpitDb = () => {
  if (!config.cockpitDatabaseUrl) throw new Error('COCKPIT_DATABASE_URL absente (backend/.env) : le cockpit a besoin de sa base PostgreSQL.');
  return (cockpit ??= new pg.Pool({ connectionString: config.cockpitDatabaseUrl, max: 5 }));
};

export const yumcoDbEnabled = () => Boolean(config.yumcoDatabaseUrl);

/** Toute transaction est en lecture seule : le cockpit ne peut rien modifier dans la base Yumco. */
export const yumcoDb = () => {
  if (!config.yumcoDatabaseUrl) throw new Error('YUMCO_DATABASE_URL absente (backend/.env).');
  return (yumco ??= new pg.Pool({ connectionString: config.yumcoDatabaseUrl, max: 3, options: '-c default_transaction_read_only=on' }));
};

/** Tables documents : une ligne par élément, contenu en JSON. */
export const COLLECTIONS = ['agents', 'projects', 'tasks', 'contents', 'meetings', 'conversations', 'notifications', 'activities', 'drafts'] as const;
export type CollectionName = (typeof COLLECTIONS)[number];

/** Création des tables au démarrage (idempotent). */
export const migrateCockpitDb = async () => {
  const sql = [
    ...COLLECTIONS.map(
      (name) => `create table if not exists ${name} (id text primary key, data jsonb not null, updated_at timestamptz not null default now())`,
    ),
    // Informations propres au cockpit sur un restaurant Yumco (notes, étapes, agent…), le reste vient de la base Yumco.
    'create table if not exists restaurant_profiles (yumco_restaurant_id integer primary key, data jsonb not null, updated_at timestamptz not null default now())',
    // Réglages, finances et ordre d'affichage des listes.
    'create table if not exists app_state (key text primary key, data jsonb not null, updated_at timestamptz not null default now())',
  ];
  await cockpitDb().query(sql.join(';\n'));
};

export const closeDbs = async () => {
  await Promise.all([cockpit?.end(), yumco?.end()]);
};

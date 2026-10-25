import fs from 'node:fs';
import path from 'node:path';
import { PLATFORM_BASE_URL, platformUrl, TEST_PLATFORM_RESTAURANT_ID } from './core';

// Charge backend/.env s'il existe (Node ≥ 20.12, sans dépendance).
if (fs.existsSync('.env')) process.loadEnvFile('.env');

const bool = (v: string | undefined, fallback: boolean) => (v === undefined ? fallback : v === 'true' || v === '1');

export const config = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  persist: bool(process.env.PERSIST, true),
  dataFile: path.resolve(process.env.DATA_FILE ?? './data/db.json'),
  uploadsDir: path.resolve(process.env.UPLOADS_DIR ?? './data/uploads'),
  designsDir: path.resolve(process.env.DESIGNS_DIR ?? './data/designs'),
  /** `claude` si une clé API est présente, sinon `simulated` (aucune IA appelée). */
  designGenerator: (process.env.DESIGN_GENERATOR ?? (process.env.ANTHROPIC_API_KEY ? 'claude' : 'simulated')) as 'claude' | 'simulated',
  designModel: process.env.DESIGN_MODEL ?? 'claude-opus-5-5',
  designEffort: (process.env.DESIGN_EFFORT ?? 'high') as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
  /** Nombre de maquettes générées en parallèle ; les autres restent « en attente ». */
  designConcurrency: Math.max(1, Number(process.env.DESIGN_CONCURRENCY ?? 2)),
  /** Page du restaurant sur la plateforme Yumco (boutons Commander et Réserver). */
  platformUrl: platformUrl(process.env.PLATFORM_RESTAURANT_ID ?? TEST_PLATFORM_RESTAURANT_ID, process.env.PLATFORM_BASE_URL ?? PLATFORM_BASE_URL),
  /* Agent développeur (Next.js) */
  /** `claude` (API Anthropic) ou `openrouter` (DEV_MODEL est alors un identifiant OpenRouter). */
  devProvider: (process.env.DEV_PROVIDER ?? 'claude') as 'claude' | 'openrouter',
  devModel: process.env.DEV_MODEL ?? 'claude-opus-5-5',
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
  devEffort: (process.env.DEV_EFFORT ?? 'high') as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
  /** Tentatives de l'agent développeur (première version + corrections après tests). */
  devMaxAttempts: Math.max(1, Number(process.env.DEV_MAX_ATTEMPTS ?? 3)),
  builderDir: path.resolve(process.env.BUILDER_DIR ?? './data/builder'),
  buildsDir: path.resolve(process.env.BUILDS_DIR ?? './data/builds'),
  buildTimeoutMs: Number(process.env.BUILD_TIMEOUT_MS ?? 5 * 60 * 1000),
  /** Serveur d'aperçu des sites développés : origine distincte du cockpit (le code généré y exécute du JavaScript). */
  previewPort: Number(process.env.PREVIEW_PORT ?? 4100),
  previewOrigin: process.env.PREVIEW_ORIGIN ?? `http://localhost:${process.env.PREVIEW_PORT ?? 4100}`,
  /* Mise en ligne : GitHub (un dépôt privé par restaurant) puis Vercel */
  githubToken: process.env.GITHUB_TOKEN ?? '',
  /** Organisation ou compte GitHub qui reçoit les dépôts. */
  githubOwner: process.env.GITHUB_OWNER ?? '',
  vercelToken: process.env.VERCEL_TOKEN ?? '',
  /** Équipe Vercel (facultatif, compte personnel sinon). */
  vercelTeamId: process.env.VERCEL_TEAM_ID ?? '',
  /* API Yumco (back-yumco-node) : création du restaurant, liens de questionnaire, accès du gérant */
  yumcoApiUrl: (process.env.YUMCO_API_URL ?? 'https://yumco-back-production.up.railway.app').replace(/\/$/, ''),
  /** Même valeur que COCKPIT_API_KEY sur l'API. Absente : les questionnaires ne créent pas de restaurant (mode test). */
  yumcoApiKey: process.env.YUMCO_API_KEY ?? '',
  /** Intervalle de récupération des questionnaires remplis depuis un lien. */
  importIntervalMs: Number(process.env.IMPORT_INTERVAL_MS ?? 60_000),
  /** Taille maximale d'une image envoyée (Mo). */
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 8),
};

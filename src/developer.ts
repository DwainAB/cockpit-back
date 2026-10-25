/**
 * Agent développeur : transforme la maquette validée en site Next.js (export statique),
 * le compile, lance les tests automatiques et corrige seul jusqu'à `devMaxAttempts` fois.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type Anthropic from '@anthropic-ai/sdk';
import * as z from 'zod/v4';
import {
  completeBuild,
  dayKeys,
  dayLabels,
  failBuild,
  formatAddress,
  formatDayHours,
  serviceLines,
  setBuildFixing,
  setBuildTesting,
  simulatedBuildChecks,
  startBuild,
  type BuildCheck,
  type DesignUsage,
  type SiteBuild,
  type SiteDraft,
} from './core';
import { runChecks } from './checks';
import { addUsage, claude, errorMessage, fallbackParams, responseText, usageOf } from './claude';
import { config } from './config';
import { imageBlock, readHtml } from './designer';
import { openrouterJson } from './openrouter';
import { store } from './store';
import { uploadPath } from './uploads';

/* ---------- Environnement Next.js partagé (installé une seule fois) ---------- */

export const BUILDER_PACKAGE = {
  name: 'cockpit-site-builder',
  private: true,
  dependencies: { next: '15.5.26', react: '19.1.10', 'react-dom': '19.1.10' },
  devDependencies: { typescript: '5.8.3', '@types/react': '19.1.17', '@types/react-dom': '19.1.11', '@types/node': '22.10.2' },
};

/** Fichiers fixes du projet : l'IA ne peut pas les modifier (configuration et dépendances). */
export const NEXT_CONFIG = `/** @type {import('next').NextConfig} */
export default {
  output: 'export',
  basePath: process.env.SITE_BASE_PATH || '',
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
};
`;
export const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2017',
      lib: ['dom', 'dom.iterable', 'esnext'],
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: 'esnext',
      moduleResolution: 'bundler',
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: 'preserve',
      skipLibCheck: true,
      allowJs: false,
      incremental: false,
      plugins: [{ name: 'next' }],
    },
    include: ['next-env.d.ts', '**/*.ts', '**/*.tsx'],
    exclude: ['node_modules'],
  },
  null,
  2,
);
export const NEXT_ENV = `/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n`;

/** Environnement minimal des commandes : la clé API et les autres secrets ne sont jamais transmis. */
export const safeEnv = (extra: Record<string, string> = {}) => ({
  PATH: process.env.PATH ?? '',
  HOME: process.env.HOME ?? '',
  NODE_ENV: 'production',
  NEXT_TELEMETRY_DISABLED: '1',
  ...extra,
});

export const run = (cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number) =>
  new Promise<{ ok: boolean; output: string }>((resolve) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const keep = (d: Buffer) => {
      output = (output + d.toString()).slice(-20000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      output += '\n[délai dépassé]';
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, output });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, output: err.message });
    });
  });

let workspaceReady: Promise<void> | null = null;

/** Installe Next.js une fois dans `data/builder` ; les sites y empruntent leurs dépendances. */
const ensureWorkspace = () =>
  (workspaceReady ??= (async () => {
    if (fs.existsSync(path.join(config.builderDir, 'node_modules', 'next', 'package.json'))) return;
    fs.mkdirSync(config.builderDir, { recursive: true });
    fs.writeFileSync(path.join(config.builderDir, 'package.json'), JSON.stringify(BUILDER_PACKAGE, null, 2));
    console.log('[dev] installation de Next.js (première fois, 1 à 3 minutes)…');
    const res = await run('npm', ['install', '--no-audit', '--no-fund'], config.builderDir, safeEnv({ NODE_ENV: 'development' }), 10 * 60 * 1000);
    if (!res.ok) {
      workspaceReady = null;
      throw new Error(`Installation de Next.js impossible : ${res.output.slice(-500)}`);
    }
  })());

/* ---------- Génération du code par Claude ---------- */

const DevOutput = z.object({
  files: z.array(z.object({ path: z.string(), content: z.string() })),
  notes: z.array(z.string()),
});
type GeneratedFile = z.infer<typeof DevOutput>['files'][number];

/** Seuls ces fichiers peuvent être écrits par l'IA. */
const ALLOWED_PATH = /^app\/(layout\.tsx|page\.tsx|globals\.css|components\/[A-Za-z0-9_-]+\.tsx)$/;
/** Le code généré est exécuté pendant la compilation : on refuse tout accès au système ou au réseau. */
const FORBIDDEN = [
  /\bprocess\./,
  /\brequire\s*\(/,
  /\beval\s*\(/,
  /new\s+Function\s*\(/,
  /\bfetch\s*\(/,
  /\bimport\s*\(/,
  /child_process|node:|['"]fs['"]|['"]path['"]|['"]os['"]|['"]net['"]|['"]http['"]/,
];
const ALLOWED_IMPORT = /^(react|react-dom|next\/(font\/google|image|link|script)|\.{1,2}\/.+)$/;
/** Imports de types seulement (effacés à la compilation), par exemple `import type { Metadata } from 'next'`. */
const ALLOWED_TYPE_IMPORT = /^next$/;

const validateFiles = (files: GeneratedFile[]) => {
  const errors: string[] = [];
  if (!files.some((f) => f.path === 'app/layout.tsx')) errors.push('app/layout.tsx manquant');
  if (!files.some((f) => f.path === 'app/page.tsx')) errors.push('app/page.tsx manquant');
  for (const f of files) {
    if (!ALLOWED_PATH.test(f.path)) errors.push(`Fichier non autorisé : ${f.path}`);
    if (f.content.length > 200_000) errors.push(`Fichier trop volumineux : ${f.path}`);
    if (f.path.endsWith('.css')) continue;
    for (const re of FORBIDDEN) if (re.test(f.content)) errors.push(`${f.path} : instruction interdite (${re.source})`);
    for (const m of f.content.matchAll(/^\s*import\s+(type\s+)?(?:[^'"]*\s+from\s+)?['"]([^'"]+)['"]/gm))
      if (!ALLOWED_IMPORT.test(m[2]) && !(m[1] && ALLOWED_TYPE_IMPORT.test(m[2]))) errors.push(`${f.path} : import non autorisé « ${m[2]} »`);
  }
  return errors;
};

const SYSTEM_PROMPT = `Tu es l'agent développeur d'un studio qui crée des sites pour des restaurants.
Tu reçois une maquette HTML validée par le studio et sa spécification (sections, référencement). Tu la transformes en site Next.js 15 (App Router, TypeScript), exporté en site statique.

Exigences communes à tous les sites (non négociables) :
- accessibilité WCAG 2.1 AA : conserve exactement les couleurs et contrastes de la maquette, structure sémantique (header, main, sections titrées, footer, address), un seul h1, focus clavier visible, liens tel: et mailto: ;
- chaque image (next/image ou <img>), y compris le logo, a un attribut alt descriptif et non vide : jamais alt="" (par exemple alt="Logo de <nom du restaurant>" pour le logo, la description fournie pour les photos) ;
- mise en page soignée : conserve les marges intérieures et espacements de la maquette, aucun texte collé au bord d'un bloc, aucun débordement horizontal ;
- référencement : applique toutes les consignes de l'agent webdesign (balise <consignes_webdesign>), metadata complètes (title, description, keywords, openGraph, robots index/follow), JSON-LD ;
- performance : next/image avec dimensions, priority sur l'image principale et chargement différé ailleurs, next/font pour les polices (display swap), pas de JavaScript inutile.

Fidélité :
- reproduis exactement la maquette validée : mise en page, couleurs, typographies, textes, responsive ;
- conserve les attributs data-section de chaque section ;
- ne modifie pas les textes ; le référencement est défini par l'agent webdesign : mets-le en place tel quel.

Fichiers que tu peux produire (et aucun autre) :
- app/layout.tsx : <html lang="fr">, metadata Next.js (title, description, keywords, openGraph) issues de la spécification SEO, polices via next/font/google, données structurées JSON-LD dans <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ... }} /> ;
- app/page.tsx : la page ;
- app/globals.css : les styles (reprends le CSS de la maquette) ;
- app/components/*.tsx : composants si utile.
La configuration (next.config, tsconfig, package.json) est fournie et fixe.

Contraintes :
- imports autorisés : react, next/font/google, next/image, next/link, next/script, et tes propres fichiers ; aucune autre dépendance ; depuis 'next', uniquement des types (import type { Metadata } from 'next') ;
- pas d'accès à process, au réseau (fetch) ni au système de fichiers ; pas d'import dynamique ;
- images : uniquement celles fournies, en import statique depuis le dossier public (par exemple import terrasse from '../public/images/terrasse.jpg' depuis app/page.tsx), affichées avec next/image ou <img src={terrasse.src} alt="..." /> ; jamais de chemin d'image écrit en dur ;
- boutons Commander et Réserver : lien <a> vers l'URL exacte de la plateforme fournie ; n'affiche Commander que si la commande en ligne existe et Réserver que si le restaurant prend des réservations ; les liens #commander / #reserver de la maquette deviennent cette URL ;
- composants serveur par défaut ; "use client" seulement si une interaction l'exige (menu mobile) ;
- le code doit compiler sans erreur TypeScript (mode strict).

Dans "notes", signale ce qui mérite l'attention du studio. Renvoie toujours l'ensemble complet des fichiers.`;

const formatHours = (d: SiteDraft) =>
  dayKeys.map((k) => `${dayLabels[k]} : ${formatDayHours(d.answers.hours[k], ', ')}`).join('\n');

/** Images du formulaire copiées dans le projet, avec leur nom dans public/images. */
export const projectImages = (draft: SiteDraft) => {
  const list: { url: string; file: string; description: string }[] = [];
  const add = (url: string, base: string, description: string) => {
    const local = uploadPath(url);
    if (!local) return;
    const ext = path.extname(local.file);
    list.push({ url, file: `${base}${ext}`, description });
  };
  if (draft.answers.logo) add(draft.answers.logo.url, 'logo', 'Logo du restaurant');
  draft.answers.images.forEach((img, i) => {
    const slug = img.description.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);
    add(img.file.url, `image-${i + 1}${slug ? `-${slug}` : ''}`, img.description);
  });
  return list;
};

interface Attempt {
  files: GeneratedFile[];
  problems: string[];
}

const callDeveloper = async (draft: SiteDraft, build: SiteBuild, previous: Attempt | null, lastBuild: GeneratedFile[] | null) => {
  const version = draft.versions.find((v) => v.id === build.designVersionId)!;
  const html = readHtml(version.id) ?? '';
  const images = projectImages(draft);
  const a = draft.answers;

  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    {
      type: 'text',
      text: `<informations>
Restaurant : ${a.name} (${a.restaurantType})
URL de la plateforme (Commander et Réserver) : ${draft.platformUrl}
Services :
${serviceLines(a).map((l) => `- ${l}`).join('\n')}
Adresse : ${formatAddress(a.address)}
Téléphone : ${a.phone}
E-mail : ${a.email}
Horaires :
${formatHours(draft)}
</informations>

<specification>
Sections (attributs data-section) : ${version.sections.map((s) => `${s.id} (${s.purpose})`).join(' ; ')}
Référencement : ${version.seo ? JSON.stringify({ ...version.seo, developerNotes: undefined }) : 'non fourni : déduis un titre et une description sobres à partir de la maquette'}
</specification>

<consignes_webdesign>
${version.seo?.developerNotes?.length ? version.seo.developerNotes.map((n) => `- ${n}`).join('\n') : '- Aucune consigne particulière.'}
</consignes_webdesign>

<images>
${images.length ? images.map((i) => `- public/images/${i.file} — ${i.description} (dans la maquette : ${i.url})`).join('\n') : 'Aucune image : les visuels de la maquette sont en CSS.'}
</images>

<maquette_validee>
${html}
</maquette_validee>`,
    },
  ];
  if (a.logo) {
    const block = imageBlock(a.logo.url);
    if (block) content.push({ type: 'text', text: 'Logo :' }, block);
  }

  // Code précédent à corriger (tests en échec) ou à modifier (remarque du studio).
  const base = previous?.files ?? lastBuild;
  if (base) {
    content.push({
      type: 'text',
      text: `<code_actuel>\n${base.map((f) => `--- ${f.path}\n${f.content}`).join('\n')}\n</code_actuel>`,
    });
  }
  if (previous?.problems.length) content.push({ type: 'text', text: `Le code actuel ne passe pas les vérifications. Corrige ces problèmes :\n${previous.problems.map((p) => `- ${p}`).join('\n')}` });
  else if (lastBuild && build.feedback) content.push({ type: 'text', text: `Le studio a refusé le site avec cette remarque : « ${build.feedback} ». Modifie le code en conséquence.` });
  else content.push({ type: 'text', text: 'Développe le site.' });

  const model = config.devModel;
  if (config.devProvider === 'openrouter')
    return openrouterJson({ model, system: SYSTEM_PROMPT, content, schema: DevOutput, maxTokens: 64000, effort: config.devEffort });
  const stream = claude().beta.messages.stream({
    model,
    max_tokens: 64000,
    thinking: { type: 'adaptive' },
    output_config: { effort: config.devEffort, format: zodOutputFormat(DevOutput) },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
    ...fallbackParams(model),
  });
  const message = await stream.finalMessage();
  return { output: DevOutput.parse(JSON.parse(responseText(message))), usage: usageOf(message, model) };
};

/* ---------- Projet, compilation et tests ---------- */

const buildDir = (buildId: string) => path.join(config.buildsDir, buildId);
export const sitePath = (buildId: string) => (/^build-[a-z0-9]+$/.test(buildId) ? path.join(buildDir(buildId), 'out') : null);
export const sourceFiles = (buildId: string): GeneratedFile[] | null => {
  const file = path.join(buildDir(buildId), 'generated.json');
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as GeneratedFile[]) : null;
};
export const removeBuild = (buildId: string) => {
  if (/^build-[a-z0-9]+$/.test(buildId)) fs.rmSync(buildDir(buildId), { recursive: true, force: true });
};

const writeProject = (draft: SiteDraft, buildId: string, files: GeneratedFile[]) => {
  const dir = buildDir(buildId);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'public', 'images'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'next.config.mjs'), NEXT_CONFIG);
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), TSCONFIG);
  fs.writeFileSync(path.join(dir, 'next-env.d.ts'), NEXT_ENV);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ ...BUILDER_PACKAGE, name: 'site' }, null, 2));
  fs.symlinkSync(path.join(config.builderDir, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  for (const img of projectImages(draft)) {
    const local = uploadPath(img.url);
    if (local && fs.existsSync(local.file)) fs.copyFileSync(local.file, path.join(dir, 'public', 'images', img.file));
  }
  for (const f of files) {
    const target = path.join(dir, f.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.content);
  }
  fs.writeFileSync(path.join(dir, 'generated.json'), JSON.stringify(files));
};

/** Dernières lignes utiles d'une erreur de compilation, pour l'agent. */
const buildErrors = (output: string) =>
  output
    .split('\n')
    .filter((l) => /error|Error|failed|Type |\.tsx?:\d+/.test(l))
    .slice(-25)
    .join('\n') || output.slice(-2000);

const compileAndTest = async (draft: SiteDraft, build: SiteBuild, files: GeneratedFile[]): Promise<{ checks: BuildCheck[]; problems: string[] }> => {
  const basePath = `/s/${build.id}`;
  writeProject(draft, build.id, files);
  const res = await run(process.execPath, [path.join(config.builderDir, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], buildDir(build.id), safeEnv({ SITE_BASE_PATH: basePath }), config.buildTimeoutMs);
  if (!res.ok) {
    const errors = buildErrors(res.output);
    return { checks: [{ name: 'Compilation Next.js', passed: false, detail: errors.slice(0, 600) }], problems: [`La compilation Next.js échoue :\n${errors}`] };
  }
  const indexFile = path.join(buildDir(build.id), 'out', 'index.html');
  const html = fs.existsSync(indexFile) ? fs.readFileSync(indexFile, 'utf8') : '';
  const version = draft.versions.find((v) => v.id === build.designVersionId)!;
  const checks = [{ name: 'Compilation Next.js', passed: true }, ...runChecks(html, draft, basePath, version.sections.map((s) => s.id))];
  return { checks, problems: checks.filter((c) => !c.passed).map((c) => `${c.name} : ${c.detail ?? 'échec'}`) };
};

/* ---------- File d'attente ---------- */

const queue: { draftId: string; buildId: string }[] = [];
let running = false;

export const enqueueBuild = (draftId: string, buildId: string) => {
  queue.push({ draftId, buildId });
  void pump();
};

export const resumeBuilds = () =>
  store.snapshot.drafts.forEach((d) => d.builds.filter((b) => b.status === 'queued').forEach((b) => enqueueBuild(d.id, b.id)));

/** Un développement à la fois : la compilation Next.js est gourmande. */
const pump = async () => {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = queue.shift()!;
    await runBuild(job.draftId, job.buildId);
  }
  running = false;
};

const runBuild = async (draftId: string, buildId: string) => {
  if (!store.mutate(({ db }) => startBuild(db, draftId, buildId))) return;
  const draft = store.snapshot.drafts.find((d) => d.id === draftId)!;
  const build = draft.builds.find((b) => b.id === buildId)!;
  const started = Date.now();
  let usage: DesignUsage | null = null;
  let attempt: Attempt | null = null;
  let attempts = 0;

  try {
    if (config.designGenerator === 'simulated') {
      await new Promise((r) => setTimeout(r, 2000));
      store.mutate(({ db }) => setBuildTesting(db, draftId, buildId, 1));
      await new Promise((r) => setTimeout(r, 2000));
      const version = draft.versions.find((v) => v.id === build.designVersionId)!;
      store.mutate(({ db }) =>
        completeBuild(db, draftId, buildId, {
          checks: simulatedBuildChecks(draft.answers),
          // Sans IA, l'aperçu reprend la maquette validée.
          previewUrl: version.previewUrl,
          usage: null,
          notes: ['Développement simulé : aucune clé API, aucun code Next.js généré.'],
          simulated: true,
          attempts: 1,
        }),
      );
      return;
    }

    await ensureWorkspace();
    // Pour une modification demandée, on repart du code du dernier développement.
    const previousBuild = [...draft.builds].reverse().find((b) => b.id !== buildId && b.designVersionId === build.designVersionId && sourceFiles(b.id));
    const lastFiles = previousBuild ? sourceFiles(previousBuild.id) : null;
    let notes: string[] = [];
    let checks: BuildCheck[] = [];

    while (attempts < config.devMaxAttempts) {
      attempts += 1;
      if (attempts > 1) store.mutate(({ db }) => setBuildFixing(db, draftId, buildId, checks));
      const { output, usage: callUsage } = await callDeveloper(draft, build, attempt, lastFiles);
      usage = addUsage(usage, callUsage);
      notes = output.notes;

      const invalid = validateFiles(output.files);
      if (invalid.length) {
        checks = [{ name: 'Code conforme aux règles de sécurité', passed: false, detail: invalid.join(' ; ') }];
        attempt = { files: output.files.filter((f) => ALLOWED_PATH.test(f.path)), problems: invalid };
        continue;
      }

      store.mutate(({ db }) => setBuildTesting(db, draftId, buildId, attempts));
      const result = await compileAndTest(draft, build, output.files);
      checks = [{ name: 'Code conforme aux règles de sécurité', passed: true }, ...result.checks];
      if (!result.problems.length) {
        store.mutate(({ db }) => completeBuild(db, draftId, buildId, { checks, previewUrl: `${config.previewOrigin}/s/${buildId}/`, usage, notes, simulated: false, attempts }));
        console.log(`[dev] ${draft.answers.name} développement n° ${build.number} prêt en ${Math.round((Date.now() - started) / 1000)} s, ${attempts} tentative(s)${usage ? ` — ~${usage.costUsd} $` : ''}`);
        return;
      }
      attempt = { files: output.files, problems: result.problems };
    }
    store.mutate(({ db }) => failBuild(db, draftId, buildId, `Tests toujours en échec après ${attempts} tentatives.`, { checks, usage, attempts }));
  } catch (err) {
    console.error(`[dev] échec ${draft.answers.name} développement n° ${build.number}`, err);
    store.mutate(({ db }) => failBuild(db, draftId, buildId, errorMessage(err), { usage, attempts }));
  }
};

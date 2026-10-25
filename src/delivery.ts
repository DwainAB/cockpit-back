/**
 * Mise en ligne d'un site validé : dépôt GitHub public (un par restaurant), puis projet Vercel
 * relié à ce dépôt et déploiement en production. Les envois suivants sur GitHub
 * redéploient automatiquement le site.
 */
import fs from 'node:fs';
import path from 'node:path';
import { repoNameOf, siteSlug, updateDelivery, type SiteDraft } from './core';
import { config } from './config';
import { BUILDER_PACKAGE, NEXT_CONFIG, NEXT_ENV, projectImages, run, safeEnv, sourceFiles, TSCONFIG } from './developer';
import { store } from './store';
import { uploadPath } from './uploads';

const missingConfig = () =>
  [!config.githubToken && 'GITHUB_TOKEN', !config.githubOwner && 'GITHUB_OWNER', !config.vercelToken && 'VERCEL_TOKEN'].filter(Boolean) as string[];

/* ---------- GitHub ---------- */

const github = async <T>(method: string, url: string, body?: unknown): Promise<{ status: number; data: T }> => {
  const res = await fetch(`https://api.github.com${url}`, {
    method,
    headers: { Authorization: `Bearer ${config.githubToken}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as T;
  return { status: res.status, data };
};

/** Crée le dépôt public (dans l'organisation, ou sur le compte de l'utilisateur), ou réutilise l'existant. */
const ensureRepo = async (name: string, description: string) => {
  const existing = await github<{ id: number; html_url: string; private: boolean }>('GET', `/repos/${config.githubOwner}/${name}`);
  if (existing.status === 200) {
    // Vercel Hobby n'accepte pas les dépôts privés d'organisation : le dépôt est rendu public.
    if (existing.data.private) {
      const updated = await github<{ message?: string }>('PATCH', `/repos/${config.githubOwner}/${name}`, { private: false });
      if (updated.status !== 200) throw new Error(`GitHub : impossible de rendre le dépôt public (${updated.status}${updated.data?.message ? ` : ${updated.data.message}` : ''}).`);
    }
    return existing.data;
  }
  const me = await github<{ login: string }>('GET', '/user');
  const isUser = me.data?.login?.toLowerCase() === config.githubOwner.toLowerCase();
  const created = await github<{ id: number; html_url: string; message?: string }>('POST', isUser ? '/user/repos' : `/orgs/${config.githubOwner}/repos`, {
    name,
    description,
    // Public : requis par l'offre Vercel Hobby pour un dépôt d'organisation.
    private: false,
    auto_init: false,
  });
  if (created.status !== 201) throw new Error(`GitHub : création du dépôt impossible (${created.status}${created.data?.message ? ` : ${created.data.message}` : ''}).`);
  return created.data;
};

/** Projet Next.js complet, prêt à être déployé (sans node_modules ni fichiers de build). */
const writeExport = (draft: SiteDraft, buildId: string, dir: string) => {
  const files = sourceFiles(buildId);
  if (!files) throw new Error('Code du site introuvable sur le serveur.');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'public', 'images'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ ...BUILDER_PACKAGE, name: siteSlug(draft), scripts: { dev: 'next dev', build: 'next build' } }, null, 2));
  fs.writeFileSync(path.join(dir, 'next.config.mjs'), NEXT_CONFIG);
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), TSCONFIG);
  fs.writeFileSync(path.join(dir, 'next-env.d.ts'), NEXT_ENV);
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n.next\nout\n');
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${draft.answers.name}\n\nSite généré par le cockpit Yumco (Next.js, export statique).\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n`);
  for (const img of projectImages(draft)) {
    const local = uploadPath(img.url);
    if (local && fs.existsSync(local.file)) fs.copyFileSync(local.file, path.join(dir, 'public', 'images', img.file));
  }
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(dir, f.path)), { recursive: true });
    fs.writeFileSync(path.join(dir, f.path), f.content);
  }
};

/** Envoie le code sur la branche main. Le jeton passe par un en-tête, jamais dans l'URL ni sur le disque. */
const pushCode = async (dir: string, repo: string, message: string) => {
  const auth = Buffer.from(`x-access-token:${config.githubToken}`).toString('base64');
  const env = safeEnv({ GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Cockpit Yumco', GIT_AUTHOR_EMAIL: 'cockpit@yumco.fr', GIT_COMMITTER_NAME: 'Cockpit Yumco', GIT_COMMITTER_EMAIL: 'cockpit@yumco.fr' });
  const git = async (...args: string[]) => {
    const res = await run('git', args, dir, env, 120_000);
    if (!res.ok) throw new Error(`git ${args[0]} : ${res.output.replaceAll(config.githubToken, '***').slice(-400)}`);
  };
  await git('init', '-q', '-b', 'main');
  await git('add', '-A');
  await git('commit', '-q', '-m', message);
  // Le cockpit est la source de vérité : chaque mise en ligne remplace le contenu du dépôt.
  await git('-c', `http.extraheader=Authorization: Basic ${auth}`, 'push', '-q', '--force', `https://github.com/${config.githubOwner}/${repo}.git`, 'main');
};

/* ---------- Vercel ---------- */

const vercel = async <T>(method: string, url: string, body?: unknown): Promise<{ status: number; data: T }> => {
  const sep = url.includes('?') ? '&' : '?';
  const res = await fetch(`https://api.vercel.com${url}${config.vercelTeamId ? `${sep}teamId=${config.vercelTeamId}` : ''}`, {
    method,
    headers: { Authorization: `Bearer ${config.vercelToken}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as T;
  return { status: res.status, data };
};

type VercelError = { error?: { message?: string } };

/** Projet Vercel relié au dépôt GitHub (nécessite l'application GitHub de Vercel sur ce compte). */
const ensureProject = async (name: string, repo: string) => {
  const existing = await vercel<{ id: string }>('GET', `/v9/projects/${name}`);
  if (existing.status === 200) return existing.data;
  const created = await vercel<{ id: string } & VercelError>('POST', '/v10/projects', {
    name,
    framework: 'nextjs',
    gitRepository: { type: 'github', repo: `${config.githubOwner}/${repo}` },
  });
  if (created.status !== 200 && created.status !== 201)
    throw new Error(`Vercel : création du projet impossible (${created.status}${created.data?.error?.message ? ` : ${created.data.error.message}` : ''}).`);
  return created.data;
};

const deploy = async (name: string, repoId: number) => {
  const created = await vercel<{ id: string; url: string } & VercelError>('POST', '/v13/deployments', {
    name,
    project: name,
    target: 'production',
    gitSource: { type: 'github', repoId, ref: 'main' },
  });
  if (created.status !== 200 && created.status !== 201)
    throw new Error(`Vercel : déploiement impossible (${created.status}${created.data?.error?.message ? ` : ${created.data.error.message}` : ''}).`);
  // Attente de la fin du build Vercel (10 minutes au plus).
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const d = await vercel<{ readyState: string; alias?: string[]; url: string; errorMessage?: string }>('GET', `/v13/deployments/${created.data.id}`);
    if (d.data?.readyState === 'READY') return `https://${d.data.alias?.find((a) => a.endsWith('.vercel.app')) ?? d.data.url}`;
    if (d.data?.readyState === 'ERROR' || d.data?.readyState === 'CANCELED') throw new Error(`Vercel : le build a échoué${d.data.errorMessage ? ` (${d.data.errorMessage})` : ''}.`);
  }
  throw new Error('Vercel : déploiement trop long, vérifiez le tableau de bord Vercel.');
};

/* ---------- Orchestration ---------- */

const running = new Set<string>();

export const startDelivery = (draftId: string) => {
  if (running.has(draftId)) return;
  running.add(draftId);
  void deliver(draftId).finally(() => running.delete(draftId));
};

export const resumeDeliveries = () =>
  store.snapshot.drafts.filter((d) => d.delivery && (d.delivery.status === 'github' || d.delivery.status === 'vercel')).forEach((d) => startDelivery(d.id));

const deliver = async (draftId: string) => {
  const draft = store.snapshot.drafts.find((d) => d.id === draftId);
  const delivery = draft?.delivery;
  if (!draft || !delivery) return;
  const fail = (error: string) => store.mutate(({ db }) => updateDelivery(db, draftId, { status: 'failed', error }));

  const build = draft.builds.find((b) => b.id === delivery.buildId);
  if (build?.simulated) return fail('Site simulé (aucun code Next.js) : rien à mettre en ligne. Configurez la clé API Claude et relancez le développement.');
  const missing = missingConfig();
  if (missing.length) return fail(`Mise en ligne non configurée : ajoutez ${missing.join(', ')} dans backend/.env puis relancez.`);

  const name = repoNameOf(draft);
  const dir = path.join(config.buildsDir, `${delivery.buildId}-export`);
  try {
    const repo = await ensureRepo(name, `Site de ${draft.answers.name} (${draft.answers.restaurantType})`);
    store.mutate(({ db }) => updateDelivery(db, draftId, { repoUrl: repo.html_url }));
    writeExport(draft, delivery.buildId, dir);
    await pushCode(dir, name, `Site de ${draft.answers.name} — développement n° ${build?.number ?? '?'}`);
    console.log(`[delivery] ${draft.answers.name} : code envoyé sur ${repo.html_url}`);

    store.mutate(({ db }) => updateDelivery(db, draftId, { status: 'vercel' }));
    await ensureProject(name, name);
    const siteUrl = await deploy(name, repo.id);
    store.mutate(({ db }) => updateDelivery(db, draftId, { status: 'live', siteUrl }));
    console.log(`[delivery] ${draft.answers.name} en ligne : ${siteUrl}`);
  } catch (err) {
    console.error(`[delivery] échec ${draft.answers.name}`, err);
    fail(err instanceof Error ? err.message : 'Erreur inconnue.');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

/**
 * Domaines rattachés au projet Vercel (ajoutés dans Vercel → Settings → Domains).
 * Renvoie le premier domaine officiel vérifié, en dehors de l'adresse .vercel.app.
 */
export const detectCustomDomain = async (draft: SiteDraft) => {
  if (!config.vercelToken) throw new Error('VERCEL_TOKEN manquant dans backend/.env.');
  const res = await vercel<{ domains?: { name: string; verified: boolean; redirect?: string | null }[] } & VercelError>('GET', `/v9/projects/${repoNameOf(draft)}/domains`);
  if (res.status !== 200) throw new Error(`Vercel : lecture des domaines impossible (${res.status}${res.data?.error?.message ? ` : ${res.data.error.message}` : ''}).`);
  const custom = (res.data.domains ?? []).filter((d) => !d.name.endsWith('.vercel.app'));
  // Le domaine principal est celui qui ne redirige pas (www.x.fr redirige souvent vers x.fr ou l'inverse).
  const main = custom.find((d) => d.verified && !d.redirect) ?? custom.find((d) => d.verified);
  if (main) return { domain: main.name, pending: [] as string[] };
  return { domain: null, pending: custom.map((d) => d.name) };
};

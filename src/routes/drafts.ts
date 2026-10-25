import { Router } from 'express';
import {
  createDraft,
  deleteDraft,
  finalizableSiteUrl,
  finalizeDraft,
  markCredentialsSent,
  platformUrl,
  regenerateDesign,
  requestBuildChanges,
  retryDelivery,
  setCustomDomain,
  setRepoName,
  TEST_PLATFORM_RESTAURANT_ID,
  validateBuild,
  validateDesign,
} from '../core';
import { config } from '../config';
import { enqueueDesign, readHtml, removeHtml } from '../designer';
import { detectCustomDomain, startDelivery } from '../delivery';
import { DomainError } from '../core';
import { enqueueBuild, removeBuild } from '../developer';
import { handle, parse } from '../http';
import * as S from '../schemas';
import { store } from '../store';
import { syncSite, yumco, yumcoEnabled } from '../yumco';

/** Maquettes de site : questionnaire → génération du design → validation ou régénération. */
export const drafts = Router();

/** Questionnaire rempli dans le cockpit : le restaurant est créé dans la base Yumco avec l'offre choisie, puis le design est lancé. */
drafts.post(
  '/',
  handle(async (req, res) => {
    const { plan, answers } = parse(S.newDraftBody, req.body);
    let origin = { platformUrl: config.platformUrl, yumcoRestaurantId: null as number | null };
    if (yumcoEnabled()) {
      const created = await yumco.createRestaurant(plan, answers);
      origin = { platformUrl: created.platform_url, yumcoRestaurantId: created.restaurant_id };
    } else {
      console.warn(`[drafts] API Yumco non configurée : ${answers.name} n'est pas créé en base (page de test ${platformUrl(TEST_PLATFORM_RESTAURANT_ID)})`);
    }
    const { draft, version } = store.mutate((ctx) => createDraft(ctx, answers, { ...origin, plan, source: 'cockpit' }));
    enqueueDesign(draft.id, version.id);
    res.status(201).json(draft);
  }),
);

drafts.post(
  '/:id/regenerate',
  handle((req, res) => {
    const body = parse(S.regenerateBody, req.body);
    const { draft, version } = store.mutate((ctx) => regenerateDesign(ctx, req.params.id, body));
    enqueueDesign(draft.id, version.id);
    res.status(201).json(version);
  }),
);

drafts.post(
  '/:id/versions/:versionId/validate',
  handle((req, res) => {
    // La maquette validée part directement en développement.
    const { version, build } = store.mutate((ctx) => validateDesign(ctx, req.params.id, req.params.versionId));
    enqueueBuild(req.params.id, build.id);
    syncSite(store.snapshot.drafts.find((d) => d.id === req.params.id)?.yumcoRestaurantId, { status: 'development' });
    res.json(version);
  }),
);

/** Site refusé avec une remarque, ou développement en échec à relancer. */
drafts.post(
  '/:id/builds/changes',
  handle((req, res) => {
    const { feedback } = parse(S.buildChangesBody, req.body);
    const { draft, build } = store.mutate((ctx) => requestBuildChanges(ctx, req.params.id, feedback));
    enqueueBuild(draft.id, build.id);
    res.status(201).json(build);
  }),
);

drafts.post(
  '/:id/builds/:buildId/validate',
  handle((req, res) => {
    // Le site validé part directement sur GitHub puis Vercel.
    const build = store.mutate((ctx) => validateBuild(ctx, req.params.id, req.params.buildId));
    startDelivery(req.params.id);
    res.json(build);
  }),
);

drafts.patch(
  '/:id/repo-name',
  handle((req, res) => {
    const { name } = parse(S.repoNameBody, req.body);
    res.json(store.mutate((ctx) => setRepoName(ctx, req.params.id, name)));
  }),
);

/** Domaine officiel saisi à la main. */
drafts.patch(
  '/:id/domain',
  handle((req, res) => {
    const { domain } = parse(S.domainBody, req.body);
    res.json(store.mutate((ctx) => setCustomDomain(ctx, req.params.id, domain)));
  }),
);

/** Domaine officiel récupéré automatiquement depuis le projet Vercel. */
drafts.post(
  '/:id/domain/detect',
  handle(async (req, res) => {
    const draft = store.snapshot.drafts.find((d) => d.id === req.params.id);
    if (!draft) throw new DomainError('Maquette introuvable', 404);
    let found: Awaited<ReturnType<typeof detectCustomDomain>>;
    try {
      found = await detectCustomDomain(draft);
    } catch (err) {
      throw new DomainError((err as Error).message, 502);
    }
    if (!found.domain)
      throw new DomainError(
        found.pending.length
          ? `Domaine trouvé mais pas encore vérifié par Vercel : ${found.pending.join(', ')}. Vérifiez la configuration DNS puis réessayez.`
          : 'Aucun domaine officiel sur le projet Vercel. Ajoutez-le dans Vercel → Settings → Domains, ou saisissez-le à la main.',
        404,
      );
    res.json(store.mutate((ctx) => setCustomDomain(ctx, draft.id, found.domain!)));
  }),
);

/**
 * Fin du processus : le gérant reçoit ses accès par e-mail (compte créé avec un mot de passe provisoire),
 * puis le dossier quitte la production et devient un restaurant. Si l'e-mail ne part pas, le dossier reste ouvert.
 */
drafts.post(
  '/:id/finalize',
  handle(async (req, res) => {
    const draft = store.snapshot.drafts.find((d) => d.id === req.params.id);
    if (!draft) throw new DomainError('Maquette introuvable', 404);
    const siteUrl = finalizableSiteUrl(draft);
    if (draft.yumcoRestaurantId && !draft.credentialsSentAt) {
      let sentAt = new Date().toISOString();
      try {
        sentAt = (await yumco.sendCredentials(draft.yumcoRestaurantId, siteUrl)).credentials_sent_at;
      } catch (err) {
        // 409 : accès déjà envoyés (tentative précédente interrompue côté cockpit).
        if (!(err instanceof DomainError && err.status === 409)) throw err;
      }
      store.mutate((ctx) => markCredentialsSent(ctx, draft.id, sentAt));
      if (draft.delivery?.repoUrl) syncSite(draft.yumcoRestaurantId, { repo_url: draft.delivery.repoUrl });
    }
    res.status(201).json(store.mutate((ctx) => finalizeDraft(ctx, req.params.id)));
  }),
);

drafts.post(
  '/:id/delivery/retry',
  handle((req, res) => {
    const delivery = store.mutate((ctx) => retryDelivery(ctx, req.params.id));
    startDelivery(req.params.id);
    res.json(delivery);
  }),
);

drafts.delete(
  '/:id',
  handle((req, res) => {
    const draft = store.mutate((ctx) => deleteDraft(ctx, req.params.id));
    draft.versions.forEach((v) => removeHtml(v.id));
    draft.builds.forEach((b) => removeBuild(b.id));
    res.status(204).end();
  }),
);

/**
 * Aperçu du design. Le HTML est généré par une IA : il est servi sans exécution de script possible
 * (CSP) et affiché dans un cadre isolé côté cockpit.
 */
drafts.get('/:id/versions/:versionId/preview', (req, res) => {
  const draft = store.snapshot.drafts.find((d) => d.id === req.params.id);
  const html = draft?.versions.some((v) => v.id === req.params.versionId) ? readHtml(req.params.versionId) : null;
  if (!html) {
    res.status(404).type('text/plain').send('Aperçu introuvable');
    return;
  }
  res.set({
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy':
      "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  res.send(html);
});

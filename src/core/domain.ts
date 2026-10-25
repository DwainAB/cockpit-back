/**
 * Logique métier de la plateforme, indépendante du transport.
 *
 * Chaque fonction modifie la base `ctx.db` en place (le backend passe sa base en mémoire,
 * le mode démo du frontend passe un brouillon immer) et peut planifier des effets différés
 * via `ctx.schedule` (agent qui « travaille », réponse de chat simulée…).
 */
import type {
  Activity,
  Agent,
  AgentInput,
  Conversation,
  NewConversationInput,
  AppNotification,
  ChatMessage,
  ContentAction,
  MeetingStatus,
  NewIdeaInput,
  NewMeetingInput,
  DesignResult,
  DesignUsage,
  DesignVersion,
  ISODate,
  BuildCheck,
  QuestionnaireAnswers,
  SiteBuild,
  SiteDelivery,
  SiteDraft,
  SubscriptionPlan,
  NewTaskInput,
  Restaurant,
  Settings,
  StripeStatus,
  Task,
  TaskStatus,
  WorkflowAction,
  WorkflowStepKey,
} from './types';
import { createSeed, DEFAULT_STEP_AGENTS, simulatedReplies, standardTests, type Seed } from './mocks';
import { dayjs, nowIso, rel, uid } from './dates';
import { formatAddress, stepMeta } from './labels';
import { buildWorkflow, openingStatus, REPO_NAME_RE, repoNameOf, siteSlug } from './workflow';
import { paths, RESTAURANT_PROJECT } from './paths';

/** Base de données complète, telle que servie par `GET /api/bootstrap`. */
export type Db = Seed & { typing: Record<string, boolean> };

export interface DomainContext {
  db: Db;
  /** Planifie une mutation différée sur la base. */
  schedule: (ms: number, fn: (db: Db) => void) => void;
}

export class DomainError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export const createDb = (): Db => ({ ...createSeed(), typing: {} });

/* ---------- helpers ---------- */

const pushActivity = (db: Db, a: Omit<Activity, 'id' | 'date'>) => {
  db.activities.unshift({ id: uid('act'), date: nowIso(), ...a });
};

const pushNotification = (db: Db, n: Omit<AppNotification, 'id' | 'date' | 'read'>) => {
  db.notifications.unshift({ id: uid('notif'), date: nowIso(), read: false, ...n });
};

const find = <T extends { id: string }>(list: T[], id: string, what: string): T => {
  const item = list.find((x) => x.id === id);
  if (!item) throw new DomainError(`${what} introuvable : ${id}`, 404);
  return item;
};

const openLinkedTasks = (db: Db, pred: (t: Task) => boolean) => db.tasks.filter((t) => t.status !== 'done' && pred(t));

const workflowTasks = (db: Db, restaurantId: string, stepKey: WorkflowStepKey) =>
  openLinkedTasks(db, (t) => t.ref?.type === 'workflow' && t.ref.restaurantId === restaurantId && t.ref.stepKey === stepKey);

/** Ouvre (ou rouvre) la tâche de validation associée à une étape de revue. */
const ensureReviewTask = (db: Db, r: Restaurant, key: WorkflowStepKey) => {
  const existing = workflowTasks(db, r.id, key)[0];
  if (existing) {
    existing.status = 'awaiting_validation';
    return;
  }
  db.tasks.unshift({
    id: uid('task'),
    title: `${stepMeta(key).label} — ${r.name}`,
    description: 'Étape soumise par l’agent. Valider ou demander une modification depuis la page de production.',
    projectId: RESTAURANT_PROJECT,
    restaurantId: r.id,
    agentId: DEFAULT_STEP_AGENTS[key],
    priority: 'high',
    dueDate: rel(2),
    status: 'awaiting_validation',
    needsMyValidation: true,
    ref: { type: 'workflow', restaurantId: r.id, stepKey: key },
    comments: [],
    createdAt: nowIso(),
  });
};

/* ---------- Restaurants & production ---------- */

/* ---------- Maquettes de site ---------- */

const newVersion = (number: number, feedback: string | null, fresh: boolean): DesignVersion => ({
  id: uid('ver'),
  number,
  createdAt: nowIso(),
  completedAt: null,
  status: 'queued',
  feedback,
  fresh,
  concept: null,
  notes: [],
  sections: [],
  previewUrl: null,
  usage: null,
  error: null,
  simulated: false,
});

const findVersion = (draft: SiteDraft, versionId: string) => {
  const v = draft.versions.find((x) => x.id === versionId);
  if (!v) throw new DomainError(`Version introuvable : ${versionId}`, 404);
  return v;
};

/** Questionnaire rempli : crée la maquette et lance la première génération (version 1). */
export const createDraft = (
  { db }: DomainContext,
  answers: QuestionnaireAnswers,
  origin: { platformUrl: string; plan: SubscriptionPlan; source: SiteDraft['source']; yumcoRestaurantId: number | null },
) => {
  const now = nowIso();
  const draft: SiteDraft = {
    id: uid('draft'),
    answers,
    ...origin,
    createdAt: now,
    updatedAt: now,
    versions: [newVersion(1, null, true)],
    builds: [],
  };
  draft.repoName = siteSlug(draft);
  db.drafts.unshift(draft);
  pushActivity(
    db,
    origin.source === 'link'
      ? { type: 'submitted', actor: 'system', text: `${answers.manager.firstName} ${answers.manager.lastName} a rempli le questionnaire de ${answers.name}`, link: paths.draft(draft.id) }
      : { type: 'submitted', actor: 'me', text: `a rempli le formulaire de ${answers.name}`, link: paths.draft(draft.id) },
  );
  return { draft, version: draft.versions[0] };
};

/**
 * Nouvelle version : modification de la dernière selon la remarque, ou nouvelle proposition (`fresh`).
 * Une remarque est obligatoire pour une modification.
 */
export const regenerateDesign = ({ db }: DomainContext, draftId: string, request: { feedback?: string; fresh?: boolean }) => {
  const draft = find(db.drafts, draftId, 'Maquette');
  if (draft.versions.some((v) => v.status === 'generating' || v.status === 'queued')) throw new DomainError('Une génération est déjà en cours.', 409);
  if (draft.builds.some((b) => isBuildRunning(b))) throw new DomainError('Le site est en cours de développement : attendez la fin avant de modifier la maquette.', 409);
  const feedback = request.feedback?.trim() || null;
  const fresh = !!request.fresh;
  if (!fresh && !feedback) throw new DomainError('Indiquez ce qui ne va pas pour que l’agent corrige le design.');
  draft.versions.forEach((v) => {
    if (v.status === 'validated') v.status = 'ready';
  });
  const version = newVersion(draft.versions.length + 1, feedback, fresh);
  draft.versions.push(version);
  draft.updatedAt = nowIso();
  return { draft, version };
};

/** L'agent prend la demande en charge : la maquette passe « en préparation ». */
export const startDesign = (db: Db, draftId: string, versionId: string) => {
  const draft = db.drafts.find((d) => d.id === draftId);
  const v = draft?.versions.find((x) => x.id === versionId);
  if (!draft || !v || v.status !== 'queued') return false;
  v.status = 'generating';
  draft.updatedAt = nowIso();
  return true;
};

export const completeDesign = (
  db: Db,
  draftId: string,
  versionId: string,
  result: Omit<DesignResult, 'html'> & { html?: string; previewUrl: string | null; usage: DesignUsage | null; simulated: boolean },
) => {
  const draft = db.drafts.find((d) => d.id === draftId);
  const v = draft?.versions.find((x) => x.id === versionId);
  if (!draft || !v || (v.status !== 'generating' && v.status !== 'queued')) return;
  Object.assign(v, { ...result, status: 'ready', completedAt: nowIso(), error: null });
  draft.updatedAt = nowIso();
  pushNotification(db, { type: 'validation', title: 'Maquette à valider', body: `${draft.answers.name} — version ${v.number}${result.simulated ? ' (simulée)' : ''}.`, link: paths.draft(draft.id) });
};

export const failDesign = (db: Db, draftId: string, versionId: string, error: string) => {
  const draft = db.drafts.find((d) => d.id === draftId);
  const v = draft?.versions.find((x) => x.id === versionId);
  if (!draft || !v || (v.status !== 'generating' && v.status !== 'queued')) return;
  v.status = 'failed';
  v.error = error;
  v.completedAt = nowIso();
  draft.updatedAt = nowIso();
  pushNotification(db, { type: 'alert', title: 'Génération de la maquette échouée', body: `${draft.answers.name} — ${error}`, link: paths.draft(draft.id) });
};

export const validateDesign = ({ db }: DomainContext, draftId: string, versionId: string) => {
  const draft = find(db.drafts, draftId, 'Maquette');
  const v = findVersion(draft, versionId);
  if (v.status !== 'ready') throw new DomainError('Seule une version prête peut être validée.', 409);
  draft.versions.forEach((x) => {
    if (x.status === 'validated') x.status = 'ready';
  });
  v.status = 'validated';
  draft.updatedAt = nowIso();
  pushActivity(db, { type: 'validated', actor: 'me', text: `a validé la maquette v${v.number} de ${draft.answers.name}`, link: paths.draft(draft.id) });
  // La maquette validée part directement en développement.
  const build = newBuild(draft, v.id, null);
  draft.builds.push(build);
  return { version: v, build };
};

/* ---------- Développement du site ---------- */

const isBuildRunning = (b: SiteBuild) => b.status === 'queued' || b.status === 'building' || b.status === 'testing';

const newBuild = (draft: SiteDraft, designVersionId: string, feedback: string | null): SiteBuild => ({
  id: uid('build'),
  number: draft.builds.length + 1,
  designVersionId,
  createdAt: nowIso(),
  completedAt: null,
  status: 'queued',
  feedback,
  attempts: 0,
  checks: [],
  previewUrl: null,
  usage: null,
  notes: [],
  error: null,
  simulated: false,
});

const findBuild = (db: Db, draftId: string, buildId: string) => {
  const draft = db.drafts.find((d) => d.id === draftId);
  return { draft, build: draft?.builds.find((b) => b.id === buildId) };
};

/**
 * Site refusé (avec remarque) ou développement en échec : nouveau développement à partir de la même maquette.
 * Une remarque est obligatoire pour un refus.
 */
export const requestBuildChanges = ({ db }: DomainContext, draftId: string, feedback?: string) => {
  const draft = find(db.drafts, draftId, 'Maquette');
  const last = draft.builds.at(-1);
  if (!last) throw new DomainError('Aucun développement pour cette maquette.', 409);
  if (isBuildRunning(last)) throw new DomainError('Un développement est déjà en cours.', 409);
  const remark = feedback?.trim() || null;
  if (last.status !== 'failed' && !remark) throw new DomainError('Indiquez ce qui ne va pas pour que l’agent développeur corrige le site.');
  draft.builds.forEach((b) => {
    if (b.status === 'validated') b.status = 'ready';
  });
  const build = newBuild(draft, last.designVersionId, remark);
  draft.builds.push(build);
  draft.updatedAt = nowIso();
  return { draft, build };
};

export const validateBuild = ({ db }: DomainContext, draftId: string, buildId: string) => {
  const draft = find(db.drafts, draftId, 'Maquette');
  const build = draft.builds.find((b) => b.id === buildId);
  if (!build) throw new DomainError(`Développement introuvable : ${buildId}`, 404);
  if (build.status !== 'ready') throw new DomainError('Seul un site prêt peut être validé.', 409);
  build.status = 'validated';
  draft.updatedAt = nowIso();
  pushActivity(db, { type: 'validated', actor: 'me', text: `a validé le site de ${draft.answers.name}`, link: paths.draft(draft.id) });
  // Le site validé part directement en mise en ligne (GitHub puis Vercel).
  draft.delivery = newDelivery(build.id, draft.delivery?.repoUrl ?? null);
  return build;
};

/* ---------- Mise en ligne ---------- */

const newDelivery = (buildId: string, repoUrl: string | null): SiteDelivery => ({
  buildId,
  status: 'github',
  repoUrl,
  siteUrl: null,
  error: null,
  startedAt: nowIso(),
  completedAt: null,
  simulated: false,
});

export const setRepoName = ({ db }: DomainContext, draftId: string, name: string) => {
  const draft = find(db.drafts, draftId, 'Maquette');
  if (draft.delivery?.repoUrl) throw new DomainError('Le dépôt GitHub existe déjà : son nom ne peut plus être modifié depuis le cockpit.', 409);
  const value = name.trim().toLowerCase();
  if (!REPO_NAME_RE.test(value) || value.includes('--')) throw new DomainError('Nom invalide : minuscules, chiffres et tirets uniquement (3 à 80 caractères).');
  if (db.drafts.some((d) => d.id !== draftId && repoNameOf(d) === value)) throw new DomainError('Ce nom est déjà utilisé par un autre site.', 409);
  draft.repoName = value;
  draft.updatedAt = nowIso();
  return draft;
};

/** Nom de domaine (sans protocole ni chemin), en minuscules. */
export const normalizeDomain = (input: string) =>
  input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const setCustomDomain = ({ db }: DomainContext, draftId: string, domain: string) => {
  const draft = find(db.drafts, draftId, 'Maquette');
  if (draft.delivery?.status !== 'live') throw new DomainError('Le site doit d’abord être en ligne sur Vercel.', 409);
  const value = normalizeDomain(domain);
  if (!DOMAIN_RE.test(value)) throw new DomainError('Nom de domaine invalide (ex. : www.restaurant.fr).');
  if (value.endsWith('.vercel.app')) throw new DomainError('Indiquez le domaine officiel acheté, pas l’adresse .vercel.app.');
  draft.delivery.customDomain = value;
  draft.updatedAt = nowIso();
  return draft.delivery;
};

/** Vérifie qu'un dossier peut être terminé ; renvoie l'adresse officielle du site. */
export const finalizableSiteUrl = (draft: SiteDraft) => {
  if (draft.finalizedAt) throw new DomainError('Ce dossier est déjà terminé.', 409);
  const delivery = draft.delivery;
  if (delivery?.status !== 'live') throw new DomainError('Le site doit être en ligne avant de terminer le processus.', 409);
  if (!delivery.customDomain) throw new DomainError('Renseignez le nom de domaine officiel avant de valider.', 409);
  return `https://${delivery.customDomain}`;
};

/** Accès envoyés au gérant par l'API Yumco. */
export const markCredentialsSent = ({ db }: DomainContext, draftId: string, at: ISODate) => {
  const draft = find(db.drafts, draftId, 'Maquette');
  draft.credentialsSentAt = at;
  draft.updatedAt = nowIso();
  pushActivity(db, { type: 'validated', actor: 'system', text: `Accès envoyés à ${draft.answers.manager.email} pour ${draft.answers.name}`, link: paths.draft(draft.id) });
};

/** Dernière étape : le site est en ligne sur son domaine officiel, le dossier devient un restaurant. */
export const finalizeDraft = ({ db }: DomainContext, draftId: string) => {
  const draft = find(db.drafts, draftId, 'Maquette');
  const siteUrl = finalizableSiteUrl(draft);
  const delivery = draft.delivery!;
  const a = draft.answers;
  const now = nowIso();
  const concept = draft.versions.find((v) => v.status === 'validated')?.concept;
  // Les restaurants viennent de la base Yumco : le dossier complète la fiche du restaurant créé à l'envoi du questionnaire.
  if (!draft.yumcoRestaurantId) throw new DomainError('Ce dossier n’est lié à aucun restaurant Yumco : impossible de le terminer.', 409);
  const id = `yumco-${draft.yumcoRestaurantId}`;
  const existing = db.restaurants.find((r) => r.id === id);
  const restaurant: Restaurant = {
    ...existing,
    id,
    name: a.name,
    cuisine: a.restaurantType,
    description: concept?.summary ?? '',
    address: formatAddress(a.address),
    city: a.address.city,
    phone: a.phone,
    email: a.email,
    contact: { name: `${a.manager.firstName} ${a.manager.lastName}`, role: 'Gérant', email: a.manager.email, phone: a.manager.phone },
    socials: {},
    wantsOnlinePayment: a.wantsOnlinePayment,
    services: { reservation: a.takesReservations, onlineOrdering: a.onlineOrdering },
    status: 'active',
    billing: 'subscribed',
    stripeStatus: 'not_started',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    nextAction: 'Point de suivi à 1 mois',
    internalNotes: existing?.internalNotes ?? '',
    agentId: DEFAULT_STEP_AGENTS.delivery,
    blocker: null,
    workflow: buildWorkflow('all_done', { agents: DEFAULT_STEP_AGENTS, wantsPayment: false, startDaysAgo: 0, nowIso: () => now }),
    memory: [
      ...(a.customRequests ? [{ id: uid('mem'), date: now, text: `Demandes particulières : ${a.customRequests}`, source: 'manual' as const }] : []),
      ...(existing?.memory ?? []),
    ],
    accent: concept?.palette[0] ?? a.branding.colors[0] ?? '#3B4A9E',
    siteUrl,
    repoUrl: delivery.repoUrl,
  };
  if (existing) Object.assign(existing, restaurant);
  else db.restaurants.unshift(restaurant);
  draft.finalizedAt = now;
  draft.restaurantId = restaurant.id;
  draft.updatedAt = now;
  pushActivity(db, { type: 'restaurant_created', actor: 'me', text: `Nouveau restaurant en ligne : ${a.name} (${delivery.customDomain})`, link: paths.restaurant(restaurant.id) });
  pushNotification(db, { type: 'success', title: 'Nouveau restaurant', body: `${a.name} est en ligne sur ${delivery.customDomain}.`, link: paths.restaurant(restaurant.id) });
  return restaurant;
};

export const retryDelivery = ({ db }: DomainContext, draftId: string) => {
  const draft = find(db.drafts, draftId, 'Maquette');
  if (draft.delivery?.status !== 'failed') throw new DomainError('Aucune mise en ligne en échec à relancer.', 409);
  draft.delivery = newDelivery(draft.delivery.buildId, draft.delivery.repoUrl);
  draft.updatedAt = nowIso();
  return draft.delivery;
};

export const updateDelivery = (db: Db, draftId: string, patch: Partial<SiteDelivery>) => {
  const draft = db.drafts.find((d) => d.id === draftId);
  if (!draft?.delivery || draft.delivery.status === 'live' || draft.delivery.status === 'failed') return;
  Object.assign(draft.delivery, patch);
  draft.updatedAt = nowIso();
  if (patch.status === 'live') {
    draft.delivery.completedAt = nowIso();
    pushNotification(db, { type: 'success', title: 'Site en ligne', body: `${draft.answers.name} — ${draft.delivery.siteUrl}`, link: paths.draft(draft.id) });
  }
  if (patch.status === 'failed') {
    draft.delivery.completedAt = nowIso();
    pushNotification(db, { type: 'alert', title: 'Mise en ligne en échec', body: `${draft.answers.name} — ${patch.error}`, link: paths.draft(draft.id) });
  }
};

/** L'agent développeur prend le développement en charge. */
export const startBuild = (db: Db, draftId: string, buildId: string) => {
  const { draft, build } = findBuild(db, draftId, buildId);
  if (!draft || !build || build.status !== 'queued') return false;
  build.status = 'building';
  draft.updatedAt = nowIso();
  return true;
};

/** Code produit : compilation Next.js puis tests automatiques. */
export const setBuildTesting = (db: Db, draftId: string, buildId: string, attempts: number) => {
  const { draft, build } = findBuild(db, draftId, buildId);
  if (!draft || !build || (build.status !== 'building' && build.status !== 'testing')) return;
  build.status = 'testing';
  build.attempts = attempts;
  draft.updatedAt = nowIso();
};

/** Correction automatique après un test en échec : retour en développement. */
export const setBuildFixing = (db: Db, draftId: string, buildId: string, checks: BuildCheck[]) => {
  const { draft, build } = findBuild(db, draftId, buildId);
  if (!draft || !build || build.status !== 'testing') return;
  build.status = 'building';
  build.checks = checks;
  draft.updatedAt = nowIso();
};

export const completeBuild = (
  db: Db,
  draftId: string,
  buildId: string,
  result: { checks: BuildCheck[]; previewUrl: string | null; usage: DesignUsage | null; notes: string[]; simulated: boolean; attempts: number },
) => {
  const { draft, build } = findBuild(db, draftId, buildId);
  if (!draft || !build || !isBuildRunning(build)) return;
  Object.assign(build, result, { status: 'ready', completedAt: nowIso(), error: null });
  draft.updatedAt = nowIso();
  pushNotification(db, { type: 'validation', title: 'Site à valider', body: `${draft.answers.name} — tests réussis, développement n° ${build.number}.`, link: paths.draft(draft.id) });
};

export const failBuild = (db: Db, draftId: string, buildId: string, error: string, extra: { checks?: BuildCheck[]; usage?: DesignUsage | null; attempts?: number } = {}) => {
  const { draft, build } = findBuild(db, draftId, buildId);
  if (!draft || !build || !isBuildRunning(build)) return;
  Object.assign(build, { status: 'failed', error, completedAt: nowIso() }, extra.checks ? { checks: extra.checks } : {}, extra.usage !== undefined ? { usage: extra.usage } : {}, extra.attempts !== undefined ? { attempts: extra.attempts } : {});
  draft.updatedAt = nowIso();
  pushNotification(db, { type: 'alert', title: 'Développement du site en échec', body: `${draft.answers.name} — ${error}`, link: paths.draft(draft.id) });
};

export const deleteDraft = ({ db }: DomainContext, draftId: string) => {
  const draft = find(db.drafts, draftId, 'Maquette');
  db.drafts = db.drafts.filter((d) => d.id !== draftId);
  return draft;
};

export const workflowAction = ({ db }: DomainContext, restaurantId: string, stepKey: WorkflowStepKey, action: WorkflowAction, comment?: string) => {
  const r = find(db.restaurants, restaurantId, 'Restaurant');
  const idx = r.workflow.findIndex((x) => x.key === stepKey);
  if (idx === -1) throw new DomainError(`Étape inconnue : ${stepKey}`);
  const step = r.workflow[idx];
  if (step.status === 'done' || step.status === 'skipped' || step.status === 'todo')
    throw new DomainError(`L’étape « ${stepMeta(stepKey).label} » n’est pas l’étape en cours.`, 409);
  if (action === 'request_changes' && !comment?.trim()) throw new DomainError('Un commentaire est requis pour demander une modification.');

  const meta = stepMeta(stepKey);
  const now = nowIso();
  r.updatedAt = now;
  if (comment) step.comments.push({ id: uid('sc'), date: now, author: 'me', text: comment });

  if (action === 'validate') {
    if (step.tests?.some((t) => !t.passed)) throw new DomainError('Validation impossible tant qu’un test échoue.', 409);
    step.status = 'done';
    step.date = now;
    r.blocker = null;
    const next = r.workflow.slice(idx + 1).find((x) => x.status !== 'skipped' && x.status !== 'done');
    if (next) {
      const nextMeta = stepMeta(next.key);
      next.status = openingStatus(next.key);
      next.date = now;
      if (next.key === 'tests') next.tests = standardTests();
      r.nextAction = nextMeta.isReview ? `Valider : ${nextMeta.label.toLowerCase()}` : `Attendre : ${nextMeta.label.toLowerCase()}`;
      r.agentId = next.agentId;
      if (nextMeta.isReview) {
        ensureReviewTask(db, r, next.key);
        pushNotification(db, { type: 'validation', title: 'Nouvelle étape à valider', body: `${r.name} — ${nextMeta.label}.`, link: paths.workflow(r.id) });
      }
    } else {
      r.nextAction = 'Point de suivi à 1 mois';
    }
    if (stepKey === 'intake' && (r.status === 'pending' || r.status === 'prospect')) {
      r.status = 'production';
      r.billing = 'trial';
    }
    if (stepKey === 'visual_review' && r.wantsOnlinePayment && r.stripeStatus === 'not_started') r.stripeStatus = 'invite_to_send';
    if (stepKey === 'payment') r.stripeStatus = 'configured';
    if (stepKey === 'delivery') {
      r.status = 'active';
      r.billing = 'subscribed';
      pushNotification(db, { type: 'success', title: 'Site livré', body: `${r.name} est maintenant actif.`, link: paths.restaurant(r.id) });
    }
    workflowTasks(db, r.id, stepKey).forEach((t) => (t.status = 'done'));
    pushActivity(db, { type: 'validated', actor: 'me', text: `a validé « ${meta.label} » — ${r.name}`, link: paths.workflow(r.id) });
  }

  if (action === 'request_changes') {
    step.status = 'changes_requested';
    step.date = now;
    if (meta.isReview && idx > 0) {
      // L'étape de travail précédente est rouverte : l'agent reprend sa copie.
      const prev = r.workflow[idx - 1];
      prev.status = 'in_progress';
      prev.date = now;
      r.agentId = prev.agentId;
    }
    r.nextAction = 'Attendre la nouvelle version';
    workflowTasks(db, r.id, stepKey).forEach((t) => {
      t.status = 'in_progress';
      t.comments.push({ id: uid('tc'), date: now, author: 'me', text: `Modification demandée : ${comment}` });
    });
    pushActivity(db, { type: 'validated', actor: 'me', text: `a demandé une modification sur « ${meta.label} » — ${r.name}`, link: paths.workflow(r.id) });
  }

  if (action === 'block') {
    step.status = 'blocked';
    r.blocker = comment || `Bloqué manuellement à l’étape « ${meta.label} »`;
    r.nextAction = 'Lever le blocage';
    workflowTasks(db, r.id, stepKey).forEach((t) => (t.status = 'blocked'));
    pushActivity(db, { type: 'issue', actor: 'me', text: `a bloqué « ${meta.label} » — ${r.name}`, link: paths.workflow(r.id) });
  }

  if (action === 'unblock') {
    step.status = openingStatus(stepKey);
    // Simulation : le correctif est considéré comme appliqué, la suite de tests repasse au vert.
    if (step.tests) step.tests = standardTests();
    r.blocker = null;
    r.nextAction = meta.isReview ? `Valider : ${meta.label.toLowerCase()}` : `Attendre : ${meta.label.toLowerCase()}`;
    workflowTasks(db, r.id, stepKey).forEach((t) => (t.status = meta.isReview ? 'awaiting_validation' : 'in_progress'));
    pushActivity(db, { type: 'validated', actor: 'me', text: `a levé le blocage sur « ${meta.label} » — ${r.name}`, link: paths.workflow(r.id) });
  }

  return r;
};

export const setStripeStatus = ({ db }: DomainContext, restaurantId: string, status: StripeStatus) => {
  const r = find(db.restaurants, restaurantId, 'Restaurant');
  if (!r.wantsOnlinePayment) throw new DomainError('Ce restaurant ne souhaite pas de paiement en ligne.', 409);
  r.stripeStatus = status;
  pushActivity(db, { type: 'task', actor: 'agent-fin', text: `État du paiement mis à jour (simulation) — ${r.name}`, link: paths.restaurant(r.id) });
  return r;
};

export const addRestaurantNote = ({ db }: DomainContext, restaurantId: string, text: string) => {
  const r = find(db.restaurants, restaurantId, 'Restaurant');
  r.memory.unshift({ id: uid('mem'), date: nowIso(), text, source: 'manual' });
  return r;
};

/* ---------- Tâches ---------- */

export const addTask = ({ db }: DomainContext, input: NewTaskInput): Task => {
  const task: Task = {
    id: uid('task'),
    ...input,
    status: input.needsMyValidation ? 'awaiting_validation' : 'todo',
    comments: [],
    createdAt: nowIso(),
  };
  db.tasks.unshift(task);
  pushActivity(db, { type: 'task', actor: 'me', text: `a créé la tâche « ${task.title} »`, link: paths.tasks() });
  return task;
};

export const setTaskStatus = ({ db }: DomainContext, taskId: string, status: TaskStatus) => {
  const t = find(db.tasks, taskId, 'Tâche');
  t.status = status;
  return t;
};

export const validateTask = (ctx: DomainContext, taskId: string) => {
  const t = find(ctx.db.tasks, taskId, 'Tâche');
  // Une tâche liée délègue la validation à l'objet source pour garder toutes les vues synchronisées.
  if (t.ref?.type === 'workflow') {
    workflowAction(ctx, t.ref.restaurantId, t.ref.stepKey, 'validate');
    return t;
  }
  if (t.ref?.type === 'content') {
    const contentId = t.ref.contentId;
    const c = ctx.db.contents.find((x) => x.id === contentId);
    if (c?.status === 'topic_review' || c?.status === 'visual_review') {
      contentAction(ctx, c.id, c.status === 'topic_review' ? 'validate_topic' : 'validate_visual');
      return t;
    }
  }
  t.status = 'done';
  pushActivity(ctx.db, { type: 'validated', actor: 'me', text: `a validé « ${t.title} »`, link: paths.tasks() });
  return t;
};

export const addTaskComment = ({ db }: DomainContext, taskId: string, text: string) => {
  const t = find(db.tasks, taskId, 'Tâche');
  t.comments.push({ id: uid('tc'), date: nowIso(), author: 'me', text });
  return t;
};

/* ---------- Communication ---------- */

const alternativeTopics = [
  'Trois plats de saison qui font revenir les clients',
  'Ce que les clients regardent en premier sur un site de restaurant',
  'Portrait : une journée avec un restaurateur partenaire',
];

export const addIdea = ({ db }: DomainContext, input: NewIdeaInput) => {
  const project = find(db.projects, input.projectId, 'Projet');
  if (!project.modules.includes('communication')) throw new DomainError(`Le projet ${project.name} n’a pas de module communication.`);
  if (input.networks.includes('tiktok') && input.format !== 'video') throw new DomainError('TikTok nécessite le format vidéo.');
  const id = uid('content');
  db.contents.unshift({
    id,
    title: input.title,
    objective: input.objective,
    origin: { type: 'manual', label: 'Idée manuelle ajoutée depuis le cockpit.' },
    networks: input.networks,
    format: input.format,
    status: 'idea',
    scheduledAt: input.scheduledAt,
    projectId: input.projectId,
    agentId: 'agent-com',
    captions: {},
    generations: 0,
    history: [{ date: nowIso(), text: 'Idée créée' }],
  });
  pushActivity(db, { type: 'task', actor: 'me', text: `a ajouté l’idée « ${input.title} »`, link: paths.content(input.projectId, id) });
  return db.contents[0];
};

/** Actions autorisées selon le statut courant d'un contenu. */
const allowedContentActions: Record<ContentAction, string[]> = {
  submit_topic: ['idea'],
  validate_topic: ['topic_review'],
  another_idea: ['topic_review'],
  validate_visual: ['visual_review'],
  request_changes: ['visual_review'],
  simulate_error: ['scheduled', 'approved'],
  retry: ['error'],
};

export const contentAction = (ctx: DomainContext, contentId: string, action: ContentAction, comment?: string) => {
  const { db, schedule } = ctx;
  const c = find(db.contents, contentId, 'Contenu');
  if (!allowedContentActions[action].includes(c.status)) throw new DomainError(`Action « ${action} » impossible au statut « ${c.status} ».`, 409);
  const log = (text: string) => c.history.push({ date: nowIso(), text });

  switch (action) {
    case 'submit_topic':
      c.status = 'topic_review';
      pushNotification(db, { type: 'validation', title: 'Sujet à valider', body: c.title, link: paths.content(c.projectId, c.id) });
      break;
    case 'validate_topic':
      c.status = 'preparing';
      log('Sujet validé');
      openLinkedTasks(db, (t) => t.ref?.type === 'content' && t.ref.contentId === contentId).forEach((t) => (t.status = 'done'));
      pushActivity(db, { type: 'validated', actor: 'me', text: `a validé le sujet « ${c.title} »`, link: paths.content(c.projectId, c.id) });
      schedule(1800, (d) => generateVisual(d, contentId));
      break;
    case 'another_idea': {
      const next = alternativeTopics.find((t) => t !== c.title) ?? alternativeTopics[0];
      alternativeTopics.push(alternativeTopics.shift()!);
      log(`Autre idée demandée — ancien sujet : « ${c.title} »`);
      c.title = next;
      c.origin = { type: 'underexplored', label: 'Nouvelle proposition de l’agent après refus du sujet précédent.' };
      break;
    }
    case 'validate_visual':
      c.status = 'scheduled';
      c.scheduledAt = rel(1, 9);
      log('Visuel validé — programmé pour demain 09:00');
      pushActivity(db, { type: 'validated', actor: 'me', text: `a validé le visuel « ${c.title} » — programmé pour demain`, link: paths.content(c.projectId, c.id) });
      break;
    case 'request_changes':
      c.status = 'preparing';
      log('Modification du visuel demandée');
      schedule(1800, (d) => {
        const x = d.contents.find((y) => y.id === contentId);
        if (!x || x.status !== 'preparing') return;
        x.status = 'visual_review';
        x.generations += 1;
        x.history.push({ date: nowIso(), text: `Nouvelle version générée (génération n° ${x.generations})` });
      });
      break;
    case 'retry':
      c.status = 'scheduled';
      c.errorMessage = undefined;
      log('Nouvelle tentative de publication lancée');
      schedule(2000, (d) => {
        const x = d.contents.find((y) => y.id === contentId);
        if (!x || x.status !== 'scheduled') return;
        x.status = 'published';
        x.history.push({ date: nowIso(), text: 'Publié avec succès (simulation)' });
        pushActivity(d, { type: 'agent_done', actor: 'agent-com', text: `a publié « ${x.title} » après nouvelle tentative`, link: paths.content(x.projectId, x.id) });
      });
      break;
    case 'simulate_error':
      c.status = 'error';
      c.errorMessage = 'Publication refusée par le réseau (simulation) : jeton d’accès expiré.';
      log('Échec de publication (simulé)');
      pushNotification(db, { type: 'alert', title: 'Publication en erreur', body: c.title, link: paths.content(c.projectId, c.id) });
      break;
  }
  if (comment) log(`Commentaire : ${comment}`);
  return c;
};

/** Effet différé : l'agent communication « génère » le visuel après validation du sujet. */
const generateVisual = (db: Db, contentId: string) => {
  const c = db.contents.find((x) => x.id === contentId);
  if (!c || c.status !== 'preparing') return;
  c.status = 'visual_review';
  c.generations += 1;
  const imageNetworks = c.networks.filter((n): n is 'instagram' | 'linkedin' | 'facebook' => n !== 'tiktok');
  if (imageNetworks.length && !c.masterVisual)
    c.masterVisual = {
      title: `Visuel maître — « ${c.title} »`,
      description: 'Proposition générée (simulation) à partir du sujet validé.',
      palette: ['#3B4A9E', '#F2EDE4', '#5E9C7D'],
      adaptations: imageNetworks.map((network) => ({
        network,
        ratio: { instagram: '4:5', linkedin: '1.91:1', facebook: '1:1' }[network],
        note: 'Déclinaison automatique du visuel maître',
      })),
    };
  if (c.networks.includes('tiktok') && !c.video)
    c.video = { title: 'Vidéo verticale 9:16 — 20 s', duration: '0:20', script: ['Accroche 0–3 s', 'Démonstration 3–15 s', 'Appel à l’action 15–20 s'] };
  c.networks.forEach((n) => {
    c.captions[n] ??= `Proposition de texte pour ${n} (simulation) : ${c.title}.`;
  });
  c.history.push({ date: nowIso(), text: c.video ? 'Vidéo générée (simulation)' : 'Visuel maître et déclinaisons générés (simulation)' });
  pushNotification(db, { type: 'validation', title: 'Visuel à valider', body: c.title, link: paths.content(c.projectId, c.id) });
};

/* ---------- Réunions ---------- */

const openingEntry = (db: Db, agenda: string[]) => ({
  id: uid('tr'),
  speaker: db.agents.some((a) => a.id === 'agent-coord') ? 'agent-coord' : 'system',
  time: dayjs().format('HH:mm'),
  text: `Réunion ouverte. Ordre du jour : ${agenda.join(' · ') || 'libre'}.`,
});

export const addMeeting = ({ db }: DomainContext, input: NewMeetingInput) => {
  if (input.projectId) find(db.projects, input.projectId, 'Projet');
  input.agentIds.forEach((a) => find(db.agents, a, 'Agent'));
  const { startNow, ...data } = input;
  const id = uid('meet');
  db.meetings.unshift({
    id,
    ...data,
    date: startNow ? nowIso() : data.date,
    status: startNow ? 'in_progress' : 'planned',
    transcript: startNow ? [openingEntry(db, data.agenda)] : [],
    decisions: [],
    ideas: [],
    followUps: [],
    memoryAdded: [],
    tasksCreated: false,
  });
  pushActivity(db, { type: 'meeting', actor: 'me', text: `${startNow ? 'a démarré' : 'a planifié'} « ${input.title} »`, link: paths.discussions(id) });
  return db.meetings[0];
};

/** Message envoyé pendant une réunion : chaque agent participant répond à tour de rôle (simulation). */
export const sendMeetingMessage = ({ db, schedule }: DomainContext, meetingId: string, text: string) => {
  const m = find(db.meetings, meetingId, 'Réunion');
  if (m.status === 'done') throw new DomainError('Cette réunion est clôturée.', 409);
  if (m.status === 'planned') {
    m.status = 'in_progress';
    m.transcript.push(openingEntry(db, m.agenda));
  }
  m.transcript.push({ id: uid('tr'), speaker: 'me', time: dayjs().format('HH:mm'), text });
  const speakers = m.agentIds.filter((id) => db.agents.find((a) => a.id === id)?.enabled);
  if (!speakers.length) return m;
  db.typing[meetingId] = true;
  speakers.forEach((agentId, i) =>
    schedule(1200 * (i + 1), (d) => {
      const meeting = d.meetings.find((x) => x.id === meetingId);
      if (!meeting) return;
      const pool = simulatedReplies[agentId] ?? ['C’est noté (réponse simulée).'];
      const n = meeting.transcript.filter((t) => t.speaker === agentId).length;
      meeting.transcript.push({ id: uid('tr'), speaker: agentId, time: dayjs().format('HH:mm'), text: pool[n % pool.length] });
      if (i === speakers.length - 1) d.typing[meetingId] = false;
    }),
  );
  return m;
};

export const setMeetingStatus = ({ db }: DomainContext, meetingId: string, status: MeetingStatus) => {
  const m = find(db.meetings, meetingId, 'Réunion');
  m.status = status;
  if (status === 'in_progress')
    m.transcript.push(openingEntry(db, m.agenda));
  if (status === 'done') m.transcript.push({ id: uid('tr'), speaker: 'system', time: dayjs().format('HH:mm'), text: 'Réunion clôturée. Compte rendu archivé.' });
  return m;
};

export const addMeetingItem = ({ db }: DomainContext, meetingId: string, kind: 'decisions' | 'ideas' | 'followUps', text: string) => {
  const m = find(db.meetings, meetingId, 'Réunion');
  m[kind].push({ id: uid('mi'), text });
  if (kind === 'decisions') {
    // Une décision de réunion transverse est mémorisée dans tous les projets.
    m.memoryAdded.push(text);
    db.projects
      .filter((p) => m.projectId === null || p.id === m.projectId)
      .forEach((p) => p.memory.unshift({ id: uid('mem'), date: nowIso(), text, source: 'meeting', sourceId: m.id }));
  }
  return m;
};

export const addTranscriptNote = ({ db }: DomainContext, meetingId: string, text: string) => {
  const m = find(db.meetings, meetingId, 'Réunion');
  m.transcript.push({ id: uid('tr'), speaker: 'me', time: dayjs().format('HH:mm'), text });
  return m;
};

export const createTasksFromMeeting = ({ db }: DomainContext, meetingId: string) => {
  const m = find(db.meetings, meetingId, 'Réunion');
  const owner = m.agentIds.find((a) => a !== 'agent-coord') ?? m.agentIds[0];
  // Une réunion transverse rattache ses tâches au premier projet de l'agent responsable.
  const projectId = m.projectId ?? db.agents.find((a) => a.id === owner)?.projectIds[0] ?? RESTAURANT_PROJECT;
  let count = 0;
  [...m.decisions, ...m.ideas].forEach((item) => {
    if (item.taskId || item.contentId) return;
    const id = uid('task');
    item.taskId = id;
    count += 1;
    db.tasks.unshift({
      id,
      title: item.text.length > 70 ? `${item.text.slice(0, 68)}…` : item.text,
      description: `Issue de la réunion « ${m.title} » du ${dayjs(m.date).format('D MMMM')}.\n${item.text}`,
      projectId,
      agentId: owner,
      priority: 'medium',
      dueDate: rel(7),
      status: 'todo',
      needsMyValidation: false,
      ref: { type: 'meeting', meetingId: m.id },
      comments: [],
      createdAt: nowIso(),
    });
  });
  m.tasksCreated = true;
  if (count) pushActivity(db, { type: 'task', actor: 'agent-coord', text: `a créé ${count} tâche(s) depuis « ${m.title} »`, link: paths.tasks() });
  return count;
};

/* ---------- Projets ---------- */

export const addProjectNote = ({ db }: DomainContext, projectId: string, text: string) => {
  const p = find(db.projects, projectId, 'Projet');
  p.memory.unshift({ id: uid('mem'), date: nowIso(), text, source: 'manual' });
  return p;
};

export const toggleProjectSetting = ({ db }: DomainContext, projectId: string, key: 'weeklyMeeting' | 'requireValidation') => {
  const p = find(db.projects, projectId, 'Projet');
  p.settings[key] = !p.settings[key];
  return p;
};

/* ---------- Conversations (réponses simulées, aucune IA connectée) ---------- */

export const createConversation = ({ db }: DomainContext, input: NewConversationInput): Conversation => {
  const agent = find(db.agents, input.agentId, 'Agent');
  const project = find(db.projects, input.projectId, 'Projet');
  const existing = db.conversations.find((c) => c.agentId === agent.id && c.projectId === project.id);
  if (existing) return existing;
  const conv: Conversation = {
    id: uid('conv'),
    agentId: agent.id,
    projectId: project.id,
    title: project.name,
    messages: [{ id: uid('msg'), from: 'system', text: `Nouvelle discussion avec ${agent.name} sur le projet ${project.name}. Réponses simulées.`, date: nowIso() }],
    suggestions: ['Où en est le projet ?', 'Qu’est-ce qui attend ma validation ?', 'Propose les prochaines étapes'],
  };
  db.conversations.unshift(conv);
  return conv;
};

export const sendMessage = ({ db, schedule }: DomainContext, conversationId: string, text: string, attachment?: ChatMessage['attachment']) => {
  const c = find(db.conversations, conversationId, 'Conversation');
  const message: ChatMessage = { id: uid('msg'), from: 'me', text, date: nowIso(), attachment };
  c.messages.push(message);
  if (!db.agents.find((a) => a.id === c.agentId)?.enabled) {
    c.messages.push({ id: uid('msg'), from: 'system', text: 'Cet agent est désactivé : il ne répondra pas. Réactivez-le depuis la page Agents.', date: nowIso() });
    return message;
  }
  db.typing[conversationId] = true;
  schedule(1400, (d) => {
    const conv = d.conversations.find((x) => x.id === conversationId);
    if (!conv) return;
    const pool = simulatedReplies[conv.agentId] ?? ['Message bien reçu (réponse simulée).'];
    const n = conv.messages.filter((m) => m.from === 'agent').length;
    conv.messages.push({ id: uid('msg'), from: 'agent', text: pool[n % pool.length], date: nowIso() });
    d.typing[conversationId] = false;
  });
  return message;
};

/* ---------- Notifications & paramètres ---------- */

export const markNotificationRead = ({ db }: DomainContext, id: string) => {
  const n = find(db.notifications, id, 'Notification');
  n.read = true;
  return n;
};

export const markAllNotificationsRead = ({ db }: DomainContext) => {
  db.notifications.forEach((n) => (n.read = true));
  return db.notifications.length;
};

export const toggleAutomation = ({ db }: DomainContext, id: string) => {
  const a = find(db.settings.automations, id, 'Automatisation');
  a.enabled = !a.enabled;
  return a;
};

export const updateSettings = ({ db }: DomainContext, patch: Partial<Settings>) => {
  Object.assign(db.settings, patch);
  return db.settings;
};

/* ---------- Agents ---------- */

const checkProjects = (db: Db, projectIds: string[]) => projectIds.forEach((id) => find(db.projects, id, 'Projet'));

export const updateAgent = ({ db }: DomainContext, agentId: string, patch: Partial<AgentInput>) => {
  const a = find(db.agents, agentId, 'Agent');
  if (patch.projectIds) checkProjects(db, patch.projectIds);
  Object.assign(a, patch);
  db.projects.forEach((p) => {
    const linked = a.projectIds.includes(p.id);
    if (linked && !p.agentIds.includes(a.id)) p.agentIds.push(a.id);
    if (!linked) p.agentIds = p.agentIds.filter((id) => id !== a.id);
  });
  return a;
};

const agentColors: Record<Agent['kind'], string> = {
  developer: '#2F7A5B',
  webdesign: '#A54C9E',
  communication: '#BF7514',
  finance: '#3FA0C8',
  coordinator: '#3B4A9E',
};

export const createAgent = ({ db }: DomainContext, input: AgentInput): Agent => {
  checkProjects(db, input.projectIds);
  const agent: Agent = {
    id: uid('agent'),
    ...input,
    description: input.specialty,
    availability: 'available',
    lastActivity: { date: nowIso(), text: 'Agent créé' },
    issue: null,
    color: agentColors[input.kind],
  };
  db.agents.push(agent);
  db.projects.filter((p) => input.projectIds.includes(p.id)).forEach((p) => p.agentIds.push(agent.id));
  pushActivity(db, { type: 'task', actor: 'me', text: `a créé l’agent ${agent.name}`, link: paths.agents(agent.id) });
  return agent;
};

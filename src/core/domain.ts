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
  AgentMemoryEntry,
  AgentMemoryInput,
  Conversation,
  NewConversationInput,
  AppNotification,
  ChatMessage,
  Content,
  ContentAction,
  ContentUpdate,
  EditorialIdea,
  EditorialPlan,
  MeetingStatus,
  Network,
  PostIdea,
  Project,
  PublicationResult,
  UploadedFile,
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
  SiteTask,
  StripeStatus,
  Task,
  TaskStatus,
  WorkflowAction,
  WorkflowStepKey,
} from './types';
import { createSeed, DEFAULT_STEP_AGENTS, simulatedReplies, standardTests, type Seed } from './mocks';
import { dayjs, nowIso, rel, uid } from './dates';
import { formatAddress, networkLabel, stepMeta } from './labels';
import { buildWorkflow, openingStatus, REPO_NAME_RE, repoNameOf, siteSlug } from './workflow';
import { paths, RESTAURANT_PROJECT } from './paths';
import { defaultModels, sameModels, specialtyOf } from './specialties';

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
  if (feedback) rememberFeedback(db, 'design', draft, feedback);
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
  if (remark) rememberFeedback(db, 'development', draft, remark);
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
    // L'agent du planning des posts crée le post (Lina par défaut).
    agentId: editorialPlanOf(project).agentId,
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
  publish_now: ['scheduled'],
  retry: ['error'],
};

/**
 * Circuit d'un post : idée → l'agent le crée (textes + image) → je valide ou demande une modification →
 * programmé → publié à la date choisie. Côté API, la création et la publication réelles sont lancées par
 * `backend/src/social.ts` ; en mode démo, `ctx.schedule` les simule.
 */
export const contentAction = (ctx: DomainContext, contentId: string, action: ContentAction, comment?: string) => {
  const { db, schedule } = ctx;
  const c = find(db.contents, contentId, 'Contenu');
  if (!allowedContentActions[action].includes(c.status)) throw new DomainError(`Action « ${action} » impossible au statut « ${c.status} ».`, 409);
  const log = (text: string) => c.history.push({ date: nowIso(), text });
  const agentName = db.agents.find((a) => a.id === c.agentId)?.name ?? 'L’agent';

  switch (action) {
    case 'submit_topic':
    case 'validate_topic':
      c.status = 'preparing';
      c.generationError = undefined;
      log(`Création du post demandée à ${agentName}`);
      openLinkedTasks(db, (t) => t.ref?.type === 'content' && t.ref.contentId === contentId).forEach((t) => (t.status = 'done'));
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
      // Une date déjà passée : publication dans quelques minutes.
      if (dayjs(c.scheduledAt).isBefore(dayjs())) c.scheduledAt = dayjs().add(5, 'minute').toISOString();
      log(`Post validé — publication prévue le ${dayjs(c.scheduledAt).format('D MMM à HH:mm')}`);
      pushActivity(db, { type: 'validated', actor: 'me', text: `a validé le post « ${c.title} »`, link: paths.content(c.projectId, c.id) });
      break;
    case 'request_changes': {
      const remark = comment?.trim();
      if (!remark) throw new DomainError('Indiquez la modification attendue pour que l’agent corrige le post.');
      c.status = 'preparing';
      c.generationError = undefined;
      log(`Modification demandée : ${remark}`);
      // L'agent retient la remarque pour ses prochains posts.
      const project = db.projects.find((p) => p.id === c.projectId);
      if (db.agents.some((a) => a.id === c.agentId))
        pushMemory(db, c.agentId, { text: `${project?.name ?? 'Projet'} — remarque du studio sur un post (« ${c.title} ») : ${remark}`, source: 'project', sourceId: c.id, projectId: c.projectId });
      schedule(1800, (d) => generateVisual(d, contentId));
      return c;
    }
    case 'publish_now':
      c.scheduledAt = nowIso();
      log('Publication immédiate demandée');
      schedule(2000, (d) => simulatePublication(d, contentId));
      break;
    case 'retry':
      c.status = 'scheduled';
      c.errorMessage = undefined;
      log('Nouvelle tentative de publication');
      schedule(2000, (d) => simulatePublication(d, contentId));
      break;
  }
  if (comment) log(`Commentaire : ${comment}`);
  return c;
};

/** Retouche des textes ou de la date avant publication. */
export const updateContent = ({ db }: DomainContext, contentId: string, patch: ContentUpdate) => {
  const c = find(db.contents, contentId, 'Contenu');
  if (!['idea', 'visual_review', 'scheduled', 'error'].includes(c.status)) throw new DomainError('Ce post ne peut plus être modifié.', 409);
  if (patch.captions)
    c.networks.forEach((n) => {
      const text = patch.captions?.[n];
      if (text !== undefined) c.captions[n] = text.trim();
    });
  if (patch.scheduledAt) c.scheduledAt = patch.scheduledAt;
  if (patch.title?.trim()) c.title = patch.title.trim();
  if (patch.objective !== undefined) c.objective = patch.objective.trim();
  if (patch.networks) {
    if (!patch.networks.length) throw new DomainError('Choisissez au moins un réseau.');
    c.networks = patch.networks;
  }
  const changes = [
    patch.title || patch.objective !== undefined ? 'sujet' : null,
    patch.networks ? `réseaux (${c.networks.map((n) => networkLabel[n]).join(', ')})` : null,
    patch.captions ? 'textes' : null,
    patch.scheduledAt ? `date (${dayjs(c.scheduledAt).format('D MMM à HH:mm')})` : null,
  ].filter(Boolean);
  c.history.push({ date: nowIso(), text: `Modifié : ${changes.join(', ') || 'aucun changement'}` });
  return c;
};

/** Supprime un post du cockpit (idée, post à valider, programmé…). Un post déjà publié reste en ligne sur les réseaux. */
export const deleteContent = ({ db }: DomainContext, contentId: string) => {
  const c = find(db.contents, contentId, 'Contenu');
  if (c.status === 'publishing') throw new DomainError('Publication en cours : attendez la fin avant de supprimer ce post.', 409);
  if (c.status === 'preparing') throw new DomainError('L’agent est en train de créer ce post : attendez la fin avant de le supprimer.', 409);
  db.contents = db.contents.filter((x) => x.id !== contentId);
  // La piste d'origine redevient disponible ; la discussion éditoriale ne référence plus le post.
  db.projects.forEach((p) =>
    p.ideas?.forEach((i) => {
      if (i.contentId === contentId) Object.assign(i, { status: 'kept', contentId: undefined });
    }),
  );
  db.conversations.forEach((conv) => {
    if (conv.editorial) conv.editorial.contentIds = conv.editorial.contentIds.filter((id) => id !== contentId);
  });
  pushActivity(db, { type: 'task', actor: 'me', text: `a supprimé le post « ${c.title} »`, link: paths.communication(c.projectId) });
  return { deleted: true, projectId: c.projectId };
};

/** L'agent a créé (ou recréé) le post : il attend ma validation. */
export const completePost = (db: Db, contentId: string, result: { captions: Partial<Record<Network, string>>; image?: UploadedFile; imageAlt?: string; note: string }) => {
  const c = db.contents.find((x) => x.id === contentId);
  if (!c || c.status !== 'preparing') return;
  c.captions = { ...c.captions, ...result.captions };
  if (result.image) {
    c.image = result.image;
    c.imageAlt = result.imageAlt;
  }
  c.status = 'visual_review';
  c.generations += 1;
  c.generationError = undefined;
  c.history.push({ date: nowIso(), text: result.note });
  pushNotification(db, { type: 'validation', title: 'Post à valider', body: c.title, link: paths.content(c.projectId, c.id) });
};

/** Création impossible : le post revient à l'état précédent avec l'erreur. */
export const failPost = (db: Db, contentId: string, error: string) => {
  const c = db.contents.find((x) => x.id === contentId);
  if (!c || c.status !== 'preparing') return;
  c.status = c.generations ? 'visual_review' : 'idea';
  c.generationError = error;
  c.history.push({ date: nowIso(), text: `Création du post échouée : ${error}` });
  pushNotification(db, { type: 'alert', title: 'Création du post échouée', body: `${c.title} — ${error}`, link: paths.content(c.projectId, c.id) });
};

/** Posts programmés dont l'heure est venue. */
export const duePosts = (db: Db, now = dayjs()) => db.contents.filter((c) => c.status === 'scheduled' && !dayjs(c.scheduledAt).isAfter(now));

/** Réseaux restant à publier : ceux qui n'ont pas déjà réussi (une nouvelle tentative ne republie pas un réseau réussi). */
export const pendingNetworks = (c: Content) => c.networks.filter((n) => c.publications?.[n]?.status !== 'published');

export const startPublishing = (db: Db, contentId: string) => {
  const c = db.contents.find((x) => x.id === contentId);
  if (!c || c.status !== 'scheduled') return false;
  c.status = 'publishing';
  return true;
};

/** Résultats de la publication : publié si tous les réseaux ont réussi, sinon erreur (les réussis sont conservés). */
export const recordPublications = (db: Db, contentId: string, results: Partial<Record<Network, PublicationResult>>) => {
  const c = db.contents.find((x) => x.id === contentId);
  if (!c) return;
  c.publications = { ...c.publications, ...results };
  const failed = c.networks.filter((n) => c.publications?.[n]?.status !== 'published');
  if (!failed.length) {
    c.status = 'published';
    c.errorMessage = undefined;
    c.history.push({ date: nowIso(), text: `Publié sur ${c.networks.map((n) => networkLabel[n]).join(', ')}` });
    pushActivity(db, { type: 'agent_done', actor: c.agentId, text: `a publié « ${c.title} »`, link: paths.content(c.projectId, c.id) });
    return;
  }
  c.status = 'error';
  c.errorMessage = failed.map((n) => `${networkLabel[n]} : ${c.publications?.[n]?.error ?? 'échec'}`).join(' · ');
  c.history.push({ date: nowIso(), text: `Échec de publication — ${c.errorMessage}` });
  pushNotification(db, { type: 'alert', title: 'Publication en erreur', body: `${c.title} — ${c.errorMessage}`, link: paths.content(c.projectId, c.id) });
};

/** Mode démo : publication simulée sur tous les réseaux. */
const simulatePublication = (db: Db, contentId: string) => {
  if (!startPublishing(db, contentId)) return;
  const c = db.contents.find((x) => x.id === contentId)!;
  recordPublications(db, contentId, Object.fromEntries(pendingNetworks(c).map((n) => [n, { status: 'published', at: nowIso() }])));
};

/** Mode démo : l'agent « crée » le post après un court délai. */
const generateVisual = (db: Db, contentId: string) => {
  const c = db.contents.find((x) => x.id === contentId);
  if (!c || c.status !== 'preparing') return;
  const imageNetworks = c.networks.filter((n): n is 'instagram' | 'linkedin' | 'facebook' => n !== 'tiktok');
  if (imageNetworks.length && !c.masterVisual)
    c.masterVisual = {
      title: `Visuel maître — « ${c.title} »`,
      description: 'Proposition générée (simulation) à partir du sujet.',
      palette: ['#3B4A9E', '#F2EDE4', '#5E9C7D'],
      adaptations: imageNetworks.map((network) => ({
        network,
        ratio: { instagram: '4:5', linkedin: '1.91:1', facebook: '1:1' }[network],
        note: 'Déclinaison automatique du visuel maître',
      })),
    };
  completePost(db, contentId, {
    captions: Object.fromEntries(c.networks.map((n) => [n, c.captions[n] ?? `Proposition de texte pour ${networkLabel[n]} (simulation) : ${c.title}.`])),
    note: 'Post créé (simulation)',
  });
};

/* ---------- Planning éditorial : discussion du lundi, puis posts de la semaine ---------- */

/** Réseaux disponibles pour les posts (TikTok viendra avec la génération de vidéos). */
export const POST_NETWORKS: Network[] = ['instagram', 'facebook', 'linkedin'];

export const defaultEditorialPlan = (): EditorialPlan => ({
  enabled: false,
  days: [2, 5],
  time: '11:00',
  networks: [...POST_NETWORKS],
  agentId: 'agent-com',
  briefDay: 1,
  briefTime: '09:00',
  lastBriefWeek: null,
});

export const editorialPlanOf = (p: Project): EditorialPlan => ({ ...defaultEditorialPlan(), ...p.editorial });

const atTime = (day: ReturnType<typeof dayjs>, time: string) => {
  const [h, m] = time.split(':').map(Number);
  return day.hour(h || 0).minute(m || 0).second(0).millisecond(0);
};

/** Lundi de la semaine (clé de semaine, AAAA-MM-JJ). */
export const weekKey = (d = dayjs()) => d.startOf('isoWeek').format('YYYY-MM-DD');

/** Dates de publication de la semaine, d'après le planning. */
export const weekSlots = (plan: EditorialPlan, week = dayjs().startOf('isoWeek')) =>
  [...plan.days].sort((a, b) => a - b).map((d) => atTime(week.isoWeekday(d), plan.time).toISOString());

export const updateEditorialPlan = ({ db }: DomainContext, projectId: string, patch: Partial<EditorialPlan>) => {
  const p = find(db.projects, projectId, 'Projet');
  if (patch.agentId) find(db.agents, patch.agentId, 'Agent');
  if (patch.days && (!patch.days.length || patch.days.some((d) => d < 1 || d > 7))) throw new DomainError('Choisissez au moins un jour de publication.');
  if (patch.networks && !patch.networks.length) throw new DomainError('Choisissez au moins un réseau.');
  p.editorial = { ...editorialPlanOf(p), ...patch };
  return p.editorial;
};

/** Projets dont la discussion de la semaine doit s'ouvrir (jour et heure atteints, pas encore ouverte cette semaine). */
export const dueBriefs = (db: Db, now = dayjs()) =>
  db.projects.filter((p) => {
    const plan = editorialPlanOf(p);
    if (!plan.enabled || plan.lastBriefWeek === weekKey(now)) return false;
    return !now.isBefore(atTime(now.startOf('isoWeek').isoWeekday(plan.briefDay), plan.briefTime));
  });

/** Ouvre la discussion de la semaine avec l'agent du planning ; il propose ensuite les idées (API) ou une réponse simulée (démo). */
export const openEditorialConversation = (db: Db, projectId: string, now = dayjs()) => {
  const p = find(db.projects, projectId, 'Projet');
  const plan = editorialPlanOf(p);
  const agent = find(db.agents, plan.agentId, 'Agent');
  const week = now.startOf('isoWeek');
  // Les dates déjà passées (discussion lancée en fin de semaine) partent sur la semaine suivante.
  const slots = weekSlots(plan, week).filter((s) => dayjs(s).isAfter(now));
  const finalSlots = slots.length ? slots : weekSlots(plan, week.add(1, 'week'));
  const conv: Conversation = {
    id: uid('conv'),
    agentId: agent.id,
    projectId: p.id,
    title: `Posts de la semaine du ${dayjs(finalSlots[0]).startOf('isoWeek').format('D MMMM')}`,
    messages: [
      {
        id: uid('msg'),
        from: 'system',
        text: `Discussion éditoriale avec ${agent.name} : ${finalSlots.length} post(s) à préparer (${finalSlots.map((s) => dayjs(s).format('dddd D à HH:mm')).join(', ')}) sur ${plan.networks.map((n) => networkLabel[n]).join(', ')}. Quand vous êtes d’accord sur les idées, cliquez sur « Valider les idées ».`,
        date: nowIso(),
      },
    ],
    suggestions: ['Propose-moi d’autres idées', 'On garde la première idée', 'Quel ton pour cette semaine ?'],
    editorial: { week: weekKey(dayjs(finalSlots[0])), slots: finalSlots, networks: [...plan.networks], contentIds: [] },
  };
  db.conversations.unshift(conv);
  p.editorial = { ...plan, lastBriefWeek: weekKey(now) };
  db.typing[conv.id] = true;
  pushNotification(db, { type: 'validation', title: `${agent.name} vous propose les posts de la semaine`, body: p.name, link: paths.discussions(conv.id, p.id) });
  return conv;
};

/** Idées validées dans la discussion : un post par idée, que l'agent crée aussitôt. */
export const confirmEditorialIdeas = (ctx: DomainContext, conversationId: string, ideas: EditorialIdea[]) => {
  const { db, schedule } = ctx;
  const conv = find(db.conversations, conversationId, 'Conversation');
  if (!conv.editorial) throw new DomainError('Cette discussion n’est pas une discussion éditoriale.', 409);
  if (conv.editorial.confirmedAt) throw new DomainError('Les idées de cette discussion ont déjà été validées.', 409);
  if (!ideas.length) throw new DomainError('Aucune idée à valider.');
  const created = ideas.map((idea) => {
    const content: Content = {
      id: uid('content'),
      title: idea.title.trim(),
      objective: idea.objective.trim(),
      origin: { type: 'discussion', label: `Idée retenue lors de la discussion « ${conv.title} ».` },
      networks: [...conv.editorial!.networks],
      format: 'image',
      status: 'preparing',
      scheduledAt: idea.scheduledAt,
      projectId: conv.projectId,
      agentId: conv.agentId,
      captions: {},
      generations: 0,
      history: [{ date: nowIso(), text: `Idée validée en discussion, création demandée` }],
    };
    db.contents.unshift(content);
    schedule(1800, (d) => generateVisual(d, content.id));
    return content;
  });
  conv.editorial.confirmedAt = nowIso();
  conv.editorial.contentIds = created.map((c) => c.id);
  conv.messages.push({
    id: uid('msg'),
    from: 'system',
    text: `Idées validées : ${created.map((c) => `« ${c.title} » (${dayjs(c.scheduledAt).format('dddd D')})`).join(', ')}. Les posts sont en cours de création, vous serez prévenu pour les valider.`,
    date: nowIso(),
  });
  return created;
};

/** Mode démo : idées tirées des derniers messages de l'agent. */
export const placeholderIdeas = (conv: Conversation): EditorialIdea[] =>
  (conv.editorial?.slots ?? []).map((scheduledAt, i) => ({ title: `Idée ${i + 1} de la discussion`, objective: '', scheduledAt }));

/* ---------- Pistes de posts proposées par l'agent ---------- */

/** Ajoute des pistes (sans doublon de titre avec les pistes existantes, même écartées). */
export const addPostIdeas = (db: Db, projectId: string, ideas: { title: string; reason: string }[], source: PostIdea['source'] = 'agent', conversationId?: string) => {
  const p = find(db.projects, projectId, 'Projet');
  p.ideas ??= [];
  const known = new Set(p.ideas.map((i) => i.title.trim().toLowerCase()));
  const added = ideas
    .filter((i) => i.title.trim() && !known.has(i.title.trim().toLowerCase()))
    .map((i): PostIdea => ({ id: uid('idea'), title: i.title.trim(), reason: i.reason.trim(), status: 'proposed', source, createdAt: nowIso(), conversationId }));
  p.ideas.unshift(...added);
  return added;
};

/** Supprime une piste (ex. : relevée par erreur), sans rien apprendre à l'agent, contrairement à « Écarter ». */
export const deletePostIdea = ({ db }: DomainContext, projectId: string, ideaId: string) => {
  const p = find(db.projects, projectId, 'Projet');
  find(p.ideas ?? [], ideaId, 'Piste');
  p.ideas = (p.ideas ?? []).filter((i) => i.id !== ideaId);
  return { deleted: true };
};

/** Rattache une piste à la discussion où elle a été proposée. */
export const linkPostIdea = ({ db }: DomainContext, projectId: string, ideaId: string, conversationId: string) => {
  const idea = find(find(db.projects, projectId, 'Projet').ideas ?? [], ideaId, 'Piste');
  idea.conversationId = find(db.conversations, conversationId, 'Conversation').id;
  return idea;
};

/** Retenir (en réserve pour une prochaine fois) ou écarter (l'agent ne la reproposera pas). */
export const setPostIdeaStatus = ({ db }: DomainContext, projectId: string, ideaId: string, status: 'proposed' | 'kept' | 'dismissed') => {
  const idea = find(find(db.projects, projectId, 'Projet').ideas ?? [], ideaId, 'Piste');
  idea.status = status;
  return idea;
};

/** Valider une piste : elle devient un post à la date choisie, que l'agent du planning crée aussitôt. */
export const validatePostIdea = (ctx: DomainContext, projectId: string, ideaId: string, scheduledAt: ISODate) => {
  const { db, schedule } = ctx;
  const p = find(db.projects, projectId, 'Projet');
  const idea = find(p.ideas ?? [], ideaId, 'Piste');
  if (idea.status === 'validated') throw new DomainError('Cette piste est déjà devenue un post.', 409);
  const plan = editorialPlanOf(p);
  const content: Content = {
    id: uid('content'),
    title: idea.title,
    objective: idea.reason,
    origin: { type: 'underexplored', label: `Piste proposée par l’agent : ${idea.reason}` },
    networks: [...plan.networks],
    format: 'image',
    status: 'preparing',
    scheduledAt,
    projectId: p.id,
    agentId: plan.agentId,
    captions: {},
    generations: 0,
    history: [{ date: nowIso(), text: 'Piste validée, création demandée' }],
  };
  db.contents.unshift(content);
  idea.status = 'validated';
  idea.contentId = content.id;
  schedule(1800, (d) => generateVisual(d, content.id));
  return content;
};

/** Pistes à donner à l'agent : celles en réserve à reproposer, celles écartées à éviter. */
export const ideaContext = (p: Project) => {
  const ideas = p.ideas ?? [];
  const kept = ideas.filter((i) => i.status === 'kept').map((i) => `- ${i.title}`);
  const dismissed = ideas.filter((i) => i.status === 'dismissed').map((i) => `- ${i.title}`);
  return [kept.length && `Pistes mises en réserve par le studio (à reproposer si elles conviennent) :\n${kept.join('\n')}`, dismissed.length && `Pistes écartées par le studio (ne pas les reproposer) :\n${dismissed.join('\n')}`]
    .filter(Boolean)
    .join('\n');
};

/** Dates de publication à venir (cette semaine et la suivante), pour placer une piste validée. */
export const upcomingSlots = (p: Project, now = dayjs()) => {
  const plan = editorialPlanOf(p);
  const week = now.startOf('isoWeek');
  return [...weekSlots(plan, week), ...weekSlots(plan, week.add(1, 'week'))].filter((s) => dayjs(s).isAfter(now));
};

/** Mode démo : pistes fictives. */
export const placeholderPostIdeas = () => [
  { title: 'Les coulisses d’un restaurant partenaire', reason: 'Format qui humanise la marque (simulation)' },
  { title: 'Avant / après : un menu passé en ligne', reason: 'Montre concrètement le résultat (simulation)' },
  { title: '3 erreurs à éviter sur son site de restaurant', reason: 'Conseil utile, très partagé (simulation)' },
];

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
  const speakers = m.agentIds.filter((id) => db.agents.some((a) => a.id === id));
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

/* ---------- Conversations (modèle « conversations » de l'agent côté API, réponses simulées en mode démo) ---------- */

export const createConversation = ({ db }: DomainContext, input: NewConversationInput): Conversation => {
  const agent = find(db.agents, input.agentId, 'Agent');
  const project = find(db.projects, input.projectId, 'Projet');
  const existing = db.conversations.find((c) => c.agentId === agent.id && c.projectId === project.id);
  if (existing && !input.fresh) return existing;
  const conv: Conversation = {
    id: uid('conv'),
    agentId: agent.id,
    projectId: project.id,
    title: existing ? `${project.name} — ${dayjs().format('D MMM HH:mm')}` : project.name,
    messages: [
      {
        id: uid('msg'),
        from: 'system',
        text: `Nouvelle discussion avec ${agent.name} sur le projet ${project.name}.${existing ? ' Ses souvenirs restent disponibles.' : ''}`,
        date: nowIso(),
      },
    ],
    suggestions: ['Où en est le projet ?', 'Qu’est-ce qui attend ma validation ?', 'Propose les prochaines étapes'],
  };
  db.conversations.unshift(conv);
  return conv;
};

/** Messages récents envoyés au modèle de conversation : au-delà, l'agent ne voit plus les plus anciens. */
export const CHAT_HISTORY_LIMIT = 40;

/** Remplissage du contexte d'une discussion (messages échangés, hors messages système). */
export const conversationContext = (c: Conversation) => {
  const used = c.messages.filter((m) => m.from !== 'system').length;
  return { used, limit: CHAT_HISTORY_LIMIT, ratio: Math.min(used / CHAT_HISTORY_LIMIT, 1), full: used >= CHAT_HISTORY_LIMIT };
};

/** Ajoute mon message ; l'agent est alors marqué « en train d'écrire » jusqu'à sa réponse. */
export const postUserMessage = (db: Db, conversationId: string, text: string, attachment?: ChatMessage['attachment']) => {
  const c = find(db.conversations, conversationId, 'Conversation');
  const message: ChatMessage = { id: uid('msg'), from: 'me', text, date: nowIso(), attachment };
  c.messages.push(message);
  db.typing[conversationId] = true;
  return message;
};

/** Réponse de l'agent (générée par son modèle de conversation). La conversation a pu être supprimée entre-temps. */
export const pushAgentReply = (db: Db, conversationId: string, text: string) => {
  const conv = db.conversations.find((x) => x.id === conversationId);
  db.typing[conversationId] = false;
  conv?.messages.push({ id: uid('msg'), from: 'agent', text, date: nowIso() });
};

export const failAgentReply = (db: Db, conversationId: string, error: string) => {
  const conv = db.conversations.find((x) => x.id === conversationId);
  db.typing[conversationId] = false;
  conv?.messages.push({ id: uid('msg'), from: 'system', text: `L’agent n’a pas pu répondre : ${error}`, date: nowIso() });
};

/** Mode démo : réponse simulée après un court délai. */
export const sendMessage = ({ db, schedule }: DomainContext, conversationId: string, text: string, attachment?: ChatMessage['attachment']) => {
  const message = postUserMessage(db, conversationId, text, attachment);
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
  if (patch.siteAgents) Object.values(patch.siteAgents).forEach((id) => find(db.agents, id, 'Agent'));
  Object.assign(db.settings, patch);
  return db.settings;
};

/** Agents du flux de création de site par défaut : ceux des étapes « Maquette » et « Développement des fonctionnalités ». */
export const DEFAULT_SITE_AGENTS: Record<SiteTask, string> = { design: DEFAULT_STEP_AGENTS.mockup, development: DEFAULT_STEP_AGENTS.functional_dev };

/** Agent qui réalise une tâche IA du flux de création de site (réglable dans Paramètres → Agents IA). */
export const siteAgent = (db: Db, task: SiteTask): Agent | undefined => {
  const id = db.settings.siteAgents?.[task] ?? DEFAULT_SITE_AGENTS[task];
  return db.agents.find((a) => a.id === id);
};

/* ---------- Agents ---------- */

const checkProjects = (db: Db, projectIds: string[]) => projectIds.forEach((id) => find(db.projects, id, 'Projet'));

/** Complète les agents créés avant l'arrivée des spécialités, des modèles et de la mémoire. */
export const normalizeAgent = (agent: Agent): Agent => {
  // Champs retirés : intitulé et descriptions (doublons de la spécialité et du prompt), activation, permissions et réglages de mémoire (toujours actifs).
  const legacy = agent as Agent & Partial<Record<'model' | 'provider' | 'role' | 'specialty' | 'description' | 'enabled' | 'permissions' | 'memory', unknown>>;
  (['model', 'provider', 'role', 'specialty', 'description', 'enabled', 'permissions', 'memory'] as const).forEach((k) => delete legacy[k]);
  agent.models ??= defaultModels(agent.kind);
  agent.color ||= specialtyOf(agent.kind).color;
  agent.memories ??= [];
  return agent;
};

export const updateAgent = ({ db }: DomainContext, agentId: string, patch: Partial<AgentInput>) => {
  const a = normalizeAgent(find(db.agents, agentId, 'Agent'));
  if (patch.projectIds) checkProjects(db, patch.projectIds);
  const previousKind = a.kind;
  // Nouvelle spécialité sans modèles précisés : des modèles restés par défaut suivent la spécialité.
  const followDefaults = patch.kind && patch.kind !== previousKind && !patch.models && sameModels(a.models, defaultModels(previousKind));
  Object.assign(a, patch);
  if (patch.kind) a.color = specialtyOf(patch.kind).color;
  if (followDefaults) a.models = defaultModels(a.kind);
  db.projects.forEach((p) => {
    const linked = a.projectIds.includes(p.id);
    if (linked && !p.agentIds.includes(a.id)) p.agentIds.push(a.id);
    if (!linked) p.agentIds = p.agentIds.filter((id) => id !== a.id);
  });
  return a;
};

export const createAgent = ({ db }: DomainContext, input: AgentInput): Agent => {
  checkProjects(db, input.projectIds);
  const agent: Agent = {
    id: uid('agent'),
    ...input,
    availability: 'available',
    lastActivity: { date: nowIso(), text: 'Agent créé' },
    issue: null,
    color: specialtyOf(input.kind).color,
    models: input.models ?? defaultModels(input.kind),
    memories: [],
  };
  db.agents.push(agent);
  db.projects.filter((p) => input.projectIds.includes(p.id)).forEach((p) => p.agentIds.push(agent.id));
  pushActivity(db, { type: 'task', actor: 'me', text: `a créé l’agent ${agent.name}`, link: paths.agents(agent.id) });
  return agent;
};

const agentOrThrow = (db: Db, agentId: string) => normalizeAgent(find(db.agents, agentId, 'Agent'));

/** Souvenirs ajoutés au prompt d'un appel : le contexte d'entrée reste court (quelques centaines de tokens). */
export const MEMORY_CONTEXT_LIMIT = 6;
/** Longueur maximale d'un souvenir. */
export const MEMORY_MAX_LENGTH = 400;
/** Souvenirs conservés par agent : au-delà, les plus anciens souvenirs automatiques sont oubliés (jamais ceux saisis à la main). */
const MEMORY_MAX_ENTRIES = 200;

/** Deux souvenirs disent la même chose s'ils partagent au moins 80 % de leurs mots significatifs. */
const sameMemory = (a: string, b: string) => {
  const wa = new Set(normalizeWords(a));
  const wb = new Set(normalizeWords(b));
  if (!wa.size || !wb.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  const common = [...wa].filter((w) => wb.has(w)).length;
  return common / Math.min(wa.size, wb.size) >= 0.8;
};

/** Ajoute un souvenir ; s'il existe déjà sous une forme proche, l'ancien est simplement remonté en tête (pas de doublon). */
const pushMemory = (db: Db, agentId: string, input: AgentMemoryInput): AgentMemoryEntry => {
  const agent = agentOrThrow(db, agentId);
  const text = input.text.trim().slice(0, MEMORY_MAX_LENGTH);
  const existing = agent.memories.find((m) => sameMemory(m.text, text));
  if (existing) {
    agent.memories = [existing, ...agent.memories.filter((m) => m !== existing)];
    return existing;
  }
  const entry: AgentMemoryEntry = { id: uid('mem'), text, source: input.source ?? 'manual', sourceId: input.sourceId ?? null, projectId: input.projectId ?? null, createdAt: nowIso() };
  agent.memories.unshift(entry);
  for (let i = agent.memories.length - 1; agent.memories.length > MEMORY_MAX_ENTRIES && i >= 0; i--) {
    if (agent.memories[i].source !== 'manual') agent.memories.splice(i, 1);
  }
  return entry;
};

export const addAgentMemory = ({ db }: DomainContext, agentId: string, input: AgentMemoryInput): AgentMemoryEntry => pushMemory(db, agentId, input);

/** Remarque de modification : l'agent chargé de la tâche la retient pour ce restaurant et ses prochains travaux. */
const rememberFeedback = (db: Db, task: SiteTask, draft: SiteDraft, feedback: string) => {
  const agent = siteAgent(db, task);
  const what = task === 'design' ? 'la maquette' : 'le site';
  if (agent) pushMemory(db, agent.id, { text: `${draft.answers.name} — remarque du studio sur ${what} : ${feedback}`, source: 'project', sourceId: draft.id, projectId: RESTAURANT_PROJECT });
};

export const updateAgentMemory = ({ db }: DomainContext, agentId: string, memoryId: string, patch: { text: string }): AgentMemoryEntry => {
  const memory = find(agentOrThrow(db, agentId).memories, memoryId, 'Souvenir');
  memory.text = patch.text.trim().slice(0, MEMORY_MAX_LENGTH);
  return memory;
};

export const deleteAgentMemory = ({ db }: DomainContext, agentId: string, memoryId: string) => {
  const agent = agentOrThrow(db, agentId);
  const before = agent.memories.length;
  agent.memories = agent.memories.filter((m) => m.id !== memoryId);
  if (agent.memories.length === before) throw new DomainError(`Souvenir introuvable : ${memoryId}`, 404);
  return { deleted: true };
};

export const listAgentMemories = ({ db }: { db: Db }, agentId: string, query = ''): AgentMemoryEntry[] => {
  const agent = agentOrThrow(db, agentId);
  return query.trim() ? searchAgentMemories(agent, query) : agent.memories;
};

/** Mots vides français ignorés par la recherche de souvenirs (sans accents : les mots sont comparés une fois normalisés). */
const MEMORY_STOP_WORDS = new Set([
  'avec', 'avoir', 'cette', 'dans', 'depuis', 'des', 'elle', 'elles', 'encore', 'etre', 'fait', 'faire', 'faut', 'les', 'leur', 'mais',
  'mes', 'moi', 'mon', 'nous', 'pour', 'pas', 'par', 'plus', 'que', 'quel', 'qui', 'sans', 'ses', 'son', 'sont', 'sur', 'tous', 'tout',
  'une', 'vos', 'votre', 'vous', 'aux', 'ces', 'est',
  // Mots présents dans chaque remarque mémorisée (« … — remarque du studio sur la maquette : … »).
  'remarque', 'studio', 'maquette', 'site', 'sites',
]);

const normalizeWords = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !MEMORY_STOP_WORDS.has(w));

/** Nombre de mots significatifs de la requête présents dans le texte. */
export const sharedWords = (query: string, text: string) => {
  const body = new Set(normalizeWords(text));
  return [...new Set(normalizeWords(query))].filter((t) => body.has(t)).length;
};

/**
 * Recherche par mots communs. L'API la combine à une recherche par le sens (embeddings, `backend/src/memorySearch.ts`) ;
 * seule, elle sert au mode démo et de secours si le modèle d'embeddings est indisponible.
 */
/** Souvenirs utilisables sur un projet : les siens et les souvenirs généraux (sans projet). */
export const memoriesFor = (agent: Agent, projectId?: string | null) =>
  projectId ? agent.memories.filter((m) => !m.projectId || m.projectId === projectId) : agent.memories;

export const searchAgentMemories = (agent: Agent, query: string, limit = MEMORY_CONTEXT_LIMIT, projectId?: string | null): AgentMemoryEntry[] => {
  const pool = memoriesFor(agent, projectId);
  if (!pool.length) return [];
  if (!normalizeWords(query).length) return pool.slice(0, limit);
  return pool
    .map((memory) => ({ memory, score: sharedWords(query, memory.text) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.memory.createdAt.localeCompare(a.memory.createdAt))
    .slice(0, limit)
    .map(({ memory }) => memory);
};

/** Bloc de contexte mémoire à ajouter au prompt d'un agent. */
export const agentMemoryBlock = (memories: AgentMemoryEntry[]): string => {
  if (!memories.length) return '';
  return `Mémoire de l'agent — souvenirs pertinents (ignore ceux qui ne s'appliquent pas) :\n${memories.map((m) => `- ${m.text}`).join('\n')}`;
};

/** Contexte système d'un agent : prompt + souvenirs pertinents (par défaut, recherche par mots communs). */
export const agentSystemContext = (agent: Agent, query: string, memories = searchAgentMemories(agent, query)): string =>
  [agent.instructions.trim(), agentMemoryBlock(memories)].filter(Boolean).join('\n\n');

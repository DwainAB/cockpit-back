import type { ProductionStage, Restaurant, SiteDraft, StepStatus, WorkflowStep, WorkflowStepKey } from './types';
import { stepMeta, workflowSteps } from './labels';

const stageByStep: Record<WorkflowStepKey, ProductionStage> = {
  intake: 'new',
  mockup: 'mockup_prep',
  mockup_review: 'mockup_review',
  visual_dev: 'development',
  visual_review: 'development',
  functional_dev: 'development',
  tests: 'tests',
  payment: 'tests',
  delivery: 'live',
};

const isClosed = (s: StepStatus) => s === 'done' || s === 'skipped';

/** Première étape non terminée : c'est l'étape « actuelle » du dossier. */
export const currentStep = (r: Restaurant): WorkflowStep | null =>
  r.workflow.find((s) => !isClosed(s.status)) ?? null;

export const productionStage = (r: Restaurant): ProductionStage => {
  const step = currentStep(r);
  return step ? stageByStep[step.key] : 'live';
};

export const workflowProgress = (r: Restaurant) => {
  const relevant = r.workflow.filter((s) => s.status !== 'skipped');
  const done = relevant.filter((s) => s.status === 'done').length;
  return Math.round((done / relevant.length) * 100);
};

export const currentStepLabel = (r: Restaurant) => {
  const step = currentStep(r);
  return step ? stepMeta(step.key).label : 'Site livré';
};

/** Ce que j'ai à faire sur ce dossier, s'il y a quelque chose. */
export const expectedAction = (r: Restaurant): string | null => {
  const step = currentStep(r);
  if (!step) return null;
  if (step.status === 'awaiting_validation') return `Valider : ${stepMeta(step.key).label.toLowerCase()}`;
  if (step.status === 'blocked') return 'Lever le blocage';
  return null;
};

/** Statut d'une étape au moment où elle devient l'étape courante. */
export const openingStatus = (key: WorkflowStepKey): StepStatus =>
  stepMeta(key).isReview ? 'awaiting_validation' : 'in_progress';

/** Construit un workflow fictif : étapes avant `currentKey` terminées, puis courante, puis à venir. */
export const buildWorkflow = (
  currentKey: WorkflowStepKey | 'all_done',
  opts: {
    agents: Record<WorkflowStepKey, string>;
    wantsPayment: boolean;
    currentStatus?: StepStatus;
    startDaysAgo: number;
    nowIso: (days: number) => string;
  },
): WorkflowStep[] => {
  const idx = currentKey === 'all_done' ? workflowSteps.length : workflowSteps.findIndex((s) => s.key === currentKey);
  const span = Math.max(idx, 1);
  return workflowSteps.map((meta, i) => {
    const skipped = meta.key === 'payment' && !opts.wantsPayment;
    let status: StepStatus;
    if (skipped) status = 'skipped';
    else if (i < idx) status = 'done';
    else if (i === idx) status = opts.currentStatus ?? openingStatus(meta.key);
    else status = 'todo';
    const daysAgo = i <= idx ? Math.round(opts.startDaysAgo - (opts.startDaysAgo / span) * i) : null;
    return {
      key: meta.key,
      status,
      date: daysAgo === null ? null : opts.nowIso(-Math.max(daysAgo, 0)),
      agentId: opts.agents[meta.key],
      comments: [],
    };
  });
};

/**
 * Colonne du tableau de production pour un formulaire rempli :
 * en attente → maquette en préparation → maquette à valider → développement → tests → site à valider → livraison.
 * Une maquette refusée (régénération) ou en échec repasse en préparation.
 */
export const draftStage = (d: SiteDraft): ProductionStage => {
  const latest = d.versions.at(-1);
  if (!latest) return 'new';
  if (latest.status === 'queued' && d.versions.length === 1) return 'new';
  if (latest.status === 'ready') return 'mockup_review';
  if (latest.status !== 'validated') return 'mockup_prep';
  const build = currentBuild(d);
  if (!build || build.status === 'queued' || build.status === 'building' || build.status === 'failed') return 'development';
  if (build.status === 'testing') return 'tests';
  if (build.status === 'ready') return 'site_review';
  return 'live';
};

/** Nom court et unique utilisé pour le dépôt GitHub et le projet Vercel. */
export const siteSlug = (d: SiteDraft) => {
  const base = d.answers.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'restaurant';
  return `site-${base}-${d.id.replace(/^draft-/, '')}`;
};

/** Nom du dépôt : celui choisi dans le cockpit, sinon le nom proposé par défaut. */
export const repoNameOf = (d: SiteDraft) => d.repoName || siteSlug(d);

/** Règles communes à GitHub et Vercel : minuscules, chiffres et tirets, 3 à 80 caractères. */
export const REPO_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])$/;

/** Dernier développement de la maquette validée actuelle (les anciens développements sont ignorés). */
export const currentBuild = (d: SiteDraft) => {
  const validated = d.versions.find((v) => v.status === 'validated');
  return validated ? [...d.builds].reverse().find((b) => b.designVersionId === validated.id) : undefined;
};

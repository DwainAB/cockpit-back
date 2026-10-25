import type { Restaurant, TestResult, WorkflowStepKey } from '../types';
import { AGENT } from './agents';

export const DEFAULT_STEP_AGENTS: Record<WorkflowStepKey, string> = {
  intake: AGENT.coord,
  mockup: AGENT.design,
  mockup_review: AGENT.design,
  visual_dev: AGENT.design,
  visual_review: AGENT.design,
  functional_dev: AGENT.dev,
  tests: AGENT.dev,
  payment: AGENT.fin,
  delivery: AGENT.coord,
};

export const standardTests = (failing: string[] = []): TestResult[] =>
  [
    { name: 'Affichage responsive (mobile, tablette, desktop)' },
    { name: 'Menu dynamique et allergènes' },
    { name: 'Réservation mobile', detail: 'Le bouton « Confirmer » reste désactivé sur iOS Safari après sélection du créneau.' },
    { name: 'Formulaire de contact' },
    { name: 'Performances (Lighthouse > 85)' },
    { name: 'Liens et SEO local' },
  ].map((t) => ({ name: t.name, passed: !failing.includes(t.name), detail: failing.includes(t.name) ? t.detail : undefined }));

/** Aucun restaurant fictif : les restaurants viendront d'une autre base de données. */
export const createRestaurants = (): Restaurant[] => [];

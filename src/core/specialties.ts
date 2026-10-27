/**
 * Catalogue des spécialités d'agents.
 *
 * C'est ici que l'on décide quels modèles IA utilise chaque spécialité par défaut : un pour les
 * tâches (maquettes, code…) et un pour les conversations, souvent moins cher. Un agent reçoit ces
 * modèles à sa création ; ils se modifient ensuite depuis la page Agents du cockpit.
 *
 * Pour ajouter une spécialité : ajouter son id à `AgentKind` (types.ts), une entrée
 * dans `SPECIALTIES` ci-dessous et une icône dans `AgentAvatar.tsx` (frontend).
 */
import type { AgentKind, AgentModel, AgentModels, AgentProvider, SiteTask } from './types';

/** Modèle de travail : qualité maximale pour produire maquettes, code et livrables. */
const OPUS: AgentModel = { provider: 'claude', model: 'claude-opus-5-5' };
/** Modèle de conversation : gratuit sur OpenRouter, pour économiser sur les échanges. */
const FREE_CHAT: AgentModel = { provider: 'openrouter', model: 'nvidia/nemotron-3.5-super-vl:free' };

/** Tâches IA du flux de création de site : l'agent choisi les réalise avec son modèle « tâches ». */
export const SITE_TASKS: { key: SiteTask; label: string; description: string }[] = [
  { key: 'design', label: 'Maquette du site', description: 'Crée la maquette à partir du questionnaire, puis la corrige après une demande de modification.' },
  { key: 'development', label: 'Développement du site', description: 'Code le site validé en Next.js et le corrige jusqu’à ce que les tests passent.' },
];

export const PROVIDER_LABELS: Record<AgentProvider, string> = { claude: 'Claude (Anthropic)', openrouter: 'OpenRouter' };

/** Modèles proposés dans le cockpit ; tout autre identifiant du fournisseur reste accepté. */
export const MODEL_SUGGESTIONS: Record<AgentProvider, string[]> = {
  claude: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  openrouter: ['nvidia/nemotron-3.5-super-vl:free'],
};

export interface AgentSpecialty {
  id: AgentKind;
  /** Libellé affiché dans la page Agents. */
  label: string;
  /** Description courte de ce que fait la spécialité. */
  description: string;
  color: string;
  /** Modèles attribués par défaut aux agents de cette spécialité. */
  models: AgentModels;
  /** Prompt proposé par défaut à la création. */
  defaultInstructions: string;
}

/** Liste ordonnée des spécialités (sert aussi de valeurs autorisées côté API). */
export const SPECIALTY_IDS = [
  'coordinator',
  'webdesign',
  'developer',
  'commercial',
  'marketing',
  'seo',
  'copywriter',
  'graphist',
  'communication',
  'support',
  'analyst',
  'finance',
] as const satisfies readonly AgentKind[];


export const SPECIALTIES: Record<AgentKind, AgentSpecialty> = {
  coordinator: {
    id: 'coordinator',
    label: 'Coordinateur',
    description: 'Orchestration des étapes, relances, ordre du jour et rapports.',
    color: '#3B4A9E',
    models: { task: OPUS, chat: FREE_CHAT },
    defaultInstructions: 'Tu coordonnes les autres agents. Tu prépares les ordres du jour, relances ce qui bloque et signales les décisions en attente, sans décider à ma place.',
  },
  webdesign: {
    id: 'webdesign',
    label: 'Web designer',
    description: 'Maquettes, chartes graphiques et versions visuelles des sites.',
    color: '#A54C9E',
    models: { task: OPUS, chat: FREE_CHAT },
    defaultInstructions: 'Tu conçois des maquettes sobres, lisibles et accessibles sur mobile. Tu utilises en priorité les photos fournies par le restaurant.',
  },
  developer: {
    id: 'developer',
    label: 'Développeur',
    description: 'Intégration, fonctionnalités et tests automatiques.',
    color: '#2F7A5B',
    models: { task: OPUS, chat: FREE_CHAT },
    defaultInstructions: 'Tu développes les fonctionnalités, lances la suite de tests et bloques l’étape si un test échoue.',
  },
  commercial: {
    id: 'commercial',
    label: 'Commercial',
    description: 'Prospection, propositions commerciales et suivi des clients.',
    color: '#C05621',
    models: { task: OPUS, chat: FREE_CHAT },
    defaultInstructions: 'Tu prépares les propositions commerciales et le suivi des prospects. Tu ne promets jamais un prix ou un délai sans validation.',
  },
  marketing: {
    id: 'marketing',
    label: 'Marketing',
    description: 'Stratégie, positionnement, offres et campagnes.',
    color: '#805AD5',
    models: { task: OPUS, chat: FREE_CHAT },
    defaultInstructions: 'Tu proposes des axes marketing concrets, priorisés et mesurables, adaptés au budget et à la cible.',
  },
  graphist: {
    id: 'graphist',
    label: 'Graphiste',
    description: 'Identité visuelle, supports et déclinaisons graphiques.',
    color: '#D53F8C',
    models: { task: OPUS, chat: FREE_CHAT },
    defaultInstructions: 'Tu produis des visuels cohérents avec la charte du client et tu expliques tes choix graphiques.',
  },
  communication: {
    id: 'communication',
    label: 'Communication',
    description: 'Ligne éditoriale, captions, visuels et vidéos courtes.',
    color: '#BF7514',
    models: { task: OPUS, chat: FREE_CHAT },
    defaultInstructions: 'Tu proposes deux sujets par semaine et par projet, une image maître déclinée par réseau. Tu soumets toujours avant publication.',
  },
  finance: {
    id: 'finance',
    label: 'Finance',
    description: 'Abonnements, coûts IA et suivi des paiements.',
    color: '#3FA0C8',
    models: { task: OPUS, chat: FREE_CHAT },
    defaultInstructions: 'Tu estimes les coûts et alertes au-delà de 80 % du budget. Tu ne manipules jamais de données bancaires.',
  },
  seo: {
    id: 'seo',
    label: 'SEO',
    description: 'Référencement naturel, référencement local et mots-clés.',
    color: '#2B8A8A',
    models: { task: OPUS, chat: FREE_CHAT },
    defaultInstructions: 'Tu améliores la visibilité des sites dans les moteurs de recherche : mots-clés, balises, contenu et référencement local. Tu priorises par impact.',
  },
  copywriter: {
    id: 'copywriter',
    label: 'Rédaction',
    description: 'Textes des sites, articles, e-mails et accroches.',
    color: '#8C6D1F',
    models: { task: OPUS, chat: FREE_CHAT },
    defaultInstructions: 'Tu rédiges des textes clairs, chaleureux et sans fautes, adaptés à la cible. Tu proposes toujours une version courte et une version longue.',
  },
  support: {
    id: 'support',
    label: 'Support client',
    description: 'Réponses aux clients, suivi des demandes et satisfaction.',
    color: '#4A7FC1',
    models: { task: OPUS, chat: FREE_CHAT },
    defaultInstructions: 'Tu réponds aux clients avec courtoisie et précision. Tu escalades au studio tout ce qui touche à la facturation ou à un engagement.',
  },
  analyst: {
    id: 'analyst',
    label: 'Data / analyse',
    description: 'Statistiques, tableaux de bord et recommandations chiffrées.',
    color: '#5C5F66',
    models: { task: OPUS, chat: FREE_CHAT },
    defaultInstructions: 'Tu analyses les chiffres (trafic, commandes, réservations, campagnes) et tu en tires des recommandations concrètes. Tu indiques toujours la source et la période.',
  },
};

/** Spécialité par défaut si la valeur stockée est inconnue (anciennes données). */
export const specialtyOf = (kind: AgentKind): AgentSpecialty => SPECIALTIES[kind] ?? SPECIALTIES.communication;

export const specialtyLabel = (kind: AgentKind) => specialtyOf(kind).label;

/** Copie des modèles par défaut d'une spécialité (à modifier sans toucher au catalogue). */
export const defaultModels = (kind: AgentKind): AgentModels => {
  const { task, chat } = specialtyOf(kind).models;
  return { task: { ...task }, chat: { ...chat } };
};

export const sameModels = (a: AgentModels, b: AgentModels) =>
  (['task', 'chat'] as const).every((k) => a[k].provider === b[k].provider && a[k].model === b[k].model);

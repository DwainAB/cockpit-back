import type { Agent, AgentKind } from '../types';
import { rel } from '../dates';
import { defaultModels, specialtyOf } from '../specialties';

export const AGENT = {
  dev: 'agent-dev',
  design: 'agent-design',
  com: 'agent-com',
  fin: 'agent-fin',
  coord: 'agent-coord',
} as const;

/** Couleur et modèles viennent du catalogue de spécialités. */
const identity = (kind: AgentKind) => ({ color: specialtyOf(kind).color, models: defaultModels(kind) });

/** Souvenir d'exemple, daté relativement à aujourd'hui. */
const memo = (id: string, text: string, days: number) => ({
  id,
  text,
  source: 'manual' as const,
  sourceId: null,
  createdAt: rel(days, 9, 0),
});

export const createAgents = (): Agent[] => [
  {
    id: AGENT.coord,
    kind: 'coordinator',
    name: 'Otto',
    availability: 'available',
    projectIds: ['yumco', 'argos', 'diagnoskin'],
    lastActivity: { date: rel(0, 8, 42), text: 'A préparé le rapport hebdomadaire (brouillon)' },
    issue: null,
    instructions: 'Prépare l’ordre du jour des réunions, relance les clients et signale tout ce qui attend une décision. Ne prends aucune décision à ma place.',
    ...identity('coordinator'),
    memories: [memo('mem-coord-1', 'Le rapport hebdomadaire est envoyé le vendredi à 16 h.', -14)],
  },
  {
    id: AGENT.design,
    kind: 'webdesign',
    name: 'Maya',
    availability: 'busy',
    projectIds: ['yumco'],
    lastActivity: { date: rel(0, 10, 5), text: 'A soumis la version visuelle de Sakura Ramen' },
    issue: null,
    instructions: 'Propose des maquettes sobres et lisibles sur mobile. Utilise en priorité les photos fournies par le restaurant.',
    ...identity('webdesign'),
    memories: [
      memo('mem-design-1', 'Charte Yumco : tons chauds, typographie éditoriale et photos plein écran.', -30),
      memo('mem-design-2', 'Sakura Ramen préfère un fond crème et refuse les aplats rouges vifs.', -6),
    ],
  },
  {
    id: AGENT.dev,
    kind: 'developer',
    name: 'Guwon',
    availability: 'busy',
    projectIds: ['yumco'],
    lastActivity: { date: rel(0, 7, 55), text: 'Test « Réservation mobile » en échec sur Trattoria Nonna Lucia' },
    issue: null,
    instructions: 'Développe les fonctionnalités, lance la suite de tests prédéfinie et bloque l’étape si un test échoue.',
    // Guwon réalise les sites du flux de création : code avec Claude, discute avec Nvidia (gratuit).
    color: specialtyOf('developer').color,
    models: {
      task: { provider: 'claude', model: 'claude-opus-5-5' },
      chat: { provider: 'openrouter', model: 'nvidia/nemotron-3.5-super-vl:free' },
    },
    memories: [memo('mem-dev-1', 'Les sites restaurants doivent garder un score Lighthouse mobile supérieur ou égal à 90.', -21)],
  },
  {
    id: AGENT.com,
    kind: 'communication',
    name: 'Lina',
    availability: 'available',
    projectIds: ['yumco', 'argos', 'diagnoskin'],
    lastActivity: { date: rel(-1, 17, 20), text: 'A proposé 3 pistes pour la semaine prochaine' },
    issue: null,
    instructions: 'Propose 2 sujets par semaine et par projet. Une image maître déclinée par réseau ; TikTok reste un format vidéo distinct. Toujours soumettre avant publication.',
    ...identity('communication'),
    memories: [memo('mem-com-1', 'Éviter les publications le dimanche soir : privilégier mardi et jeudi à 11 h.', -10)],
  },
  {
    id: AGENT.fin,
    kind: 'finance',
    name: 'Victor',
    availability: 'offline',
    projectIds: ['yumco', 'argos', 'diagnoskin'],
    lastActivity: { date: rel(-1, 18, 0), text: 'Estimation mensuelle des coûts IA mise à jour' },
    issue: null,
    instructions: 'Estime les coûts IA par projet et alerte au-delà de 80 % du budget. Ne manipule jamais de données bancaires.',
    ...identity('finance'),
    memories: [],
  },
];

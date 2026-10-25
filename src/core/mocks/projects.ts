import type { Project } from '../types';
import { rel } from '../dates';
import { PROJECT_IDS } from '../paths';
import { AGENT } from './agents';

export const PROJECT = PROJECT_IDS;

export const createProjects = (): Project[] => [
  {
    id: PROJECT.yumco,
    name: 'Yumco',
    category: 'Sites pour restaurants',
    color: '#3B4A9E',
    modules: ['restaurants', 'production', 'communication'],
    status: 'active',
    summary: 'Création de sites pour restaurateurs, par étapes validées, avec paiement en ligne optionnel et abonnement à 49 €/mois.',
    objective: 'Livrer 5 sites restaurants validés avant la fin du trimestre et tenir 2 publications par semaine.',
    owner: 'Moi',
    agentIds: [AGENT.coord, AGENT.design, AGENT.dev, AGENT.fin, AGENT.com],
    progress: 58,
    dueDate: rel(48),
    lastActivity: { date: rel(0, 10, 5), text: 'Version visuelle de Sakura Ramen soumise à validation' },
    memory: [
      { id: 'mem-y1', date: rel(-21), text: 'Abonnement unique à 49 €/mois, sans engagement. Période d’essai de 14 jours pendant la production.', source: 'meeting', sourceId: 'meet-budget' },
      { id: 'mem-y2', date: rel(-14), text: 'Toujours proposer la réservation en ligne, même sans paiement en ligne.', source: 'manual' },
      { id: 'mem-y3', date: rel(-6), text: 'Reparler des producteurs locaux : sujet apprécié et non traité depuis 6 semaines.', source: 'meeting', sourceId: 'meet-edito-1' },
      { id: 'mem-y4', date: rel(-6), text: 'Une image maître déclinée pour Instagram, LinkedIn et Facebook ; TikTok reste un format vidéo à part.', source: 'meeting', sourceId: 'meet-edito-1' },
      { id: 'mem-y5', date: rel(-3), text: 'Les tests « réservation mobile » doivent passer avant toute validation finale.', source: 'meeting', sourceId: 'meet-prod' },
      { id: 'mem-y6', date: rel(-3), text: 'Envoyer les invitations de paiement uniquement après validation du visuel.', source: 'meeting', sourceId: 'meet-prod' },
    ],
    settings: { weeklyMeeting: true, requireValidation: true },
  },
  {
    id: PROJECT.argos,
    name: 'Argos AI',
    category: 'Communication',
    color: '#2F7A5B',
    modules: ['communication'],
    status: 'active',
    summary: 'Pour l’instant, seule la communication sur les réseaux sociaux est gérée dans le cockpit.',
    objective: 'Installer une présence régulière sur LinkedIn et Instagram.',
    owner: 'Moi',
    agentIds: [AGENT.com, AGENT.coord, AGENT.fin],
    progress: 15,
    dueDate: rel(60),
    lastActivity: { date: rel(-2, 15), text: 'Premier sujet proposé par Lina' },
    memory: [{ id: 'mem-a1', date: rel(-8), text: 'Ton : pédagogique et concret, pas de jargon technique.', source: 'manual' }],
    settings: { weeklyMeeting: false, requireValidation: true },
  },
  {
    id: PROJECT.diagnoskin,
    name: 'Diagnoskin',
    category: 'Communication',
    color: '#A54C9E',
    modules: ['communication'],
    status: 'active',
    summary: 'Pour l’instant, seule la communication sur les réseaux sociaux est gérée dans le cockpit.',
    objective: 'Lancer la ligne éditoriale sur Instagram et TikTok.',
    owner: 'Moi',
    agentIds: [AGENT.com, AGENT.coord, AGENT.fin],
    progress: 10,
    dueDate: rel(75),
    lastActivity: { date: rel(-1, 11), text: 'Idée de vidéo TikTok ajoutée' },
    memory: [{ id: 'mem-d1', date: rel(-5), text: 'Aucune promesse médicale dans les publications : rester informatif.', source: 'manual' }],
    settings: { weeklyMeeting: false, requireValidation: true },
  },
];

import type { Conversation } from '../types';
import { rel } from '../dates';
import { AGENT } from './agents';
import { PROJECT } from './projects';

export const createConversations = (): Conversation[] => [
  {
    id: 'conv-dev',
    agentId: AGENT.dev,
    projectId: PROJECT.yumco,
    title: 'Développement des sites',
    messages: [
      {
        id: 'm1',
        from: 'agent',
        text: 'Je prendrai le relais une fois une maquette validée : je coderai le site à partir du design et de ses sections. Cette étape sera ajoutée prochainement.',
        date: rel(-1, 9),
      },
    ],
    suggestions: ['Comment vas-tu utiliser la maquette ?', 'Quels tests feras-tu ?'],
  },
  {
    id: 'conv-design',
    agentId: AGENT.design,
    projectId: PROJECT.yumco,
    title: 'Maquettes des sites',
    messages: [
      {
        id: 'm1',
        from: 'agent',
        text: 'Dès qu’un formulaire est rempli, je conçois la maquette du site à partir des réponses, du logo et des images. Vous la retrouvez dans Production des sites, colonne « Maquette à valider ».',
        date: rel(-1, 9, 30),
      },
    ],
    suggestions: ['Comment choisis-tu la direction artistique ?', 'Que fais-tu sans images ?'],
  },
  {
    id: 'conv-com',
    agentId: AGENT.com,
    projectId: PROJECT.yumco,
    title: 'Ligne éditoriale',
    messages: [
      { id: 'm1', from: 'me', text: 'Qu’est-ce que tu prévois pour lundi ?', date: rel(-1, 17, 5) },
      {
        id: 'm2',
        from: 'agent',
        text: 'Comme décidé en réunion éditoriale, je remets les producteurs locaux au programme : nous n’en avons pas parlé depuis 6 semaines. Je propose un carrousel avec une image maître déclinée pour Instagram, LinkedIn et Facebook. Le sujet attend ta validation.',
        date: rel(-1, 17, 20),
      },
      { id: 'm3', from: 'system', text: 'Contenu « Les producteurs locaux derrière nos restaurants » soumis à validation.', date: rel(-1, 17, 21) },
    ],
    suggestions: ['Propose 2 autres sujets pour jeudi', 'Pourquoi ce sujet maintenant ?', 'Où en est la vidéo TikTok ?'],
  },
  {
    id: 'conv-com-argos',
    agentId: AGENT.com,
    projectId: PROJECT.argos,
    title: 'Lancement éditorial',
    messages: [
      {
        id: 'm1',
        from: 'agent',
        text: 'Pour lancer Argos AI, je propose de commencer par un carrousel « Argos AI en 30 secondes » sur LinkedIn, puis 3 cas d’usage concrets. Le premier sujet attend ta validation.',
        date: rel(-2, 15),
      },
    ],
    suggestions: ['Propose un calendrier sur 4 semaines', 'Quel ton adopter sur Instagram ?', 'Et pour Diagnoskin ?'],
  },
  {
    id: 'conv-fin',
    agentId: AGENT.fin,
    projectId: PROJECT.yumco,
    title: 'Budget IA',
    messages: [
      {
        id: 'm1',
        from: 'agent',
        text: 'Point du mois (données fictives) : dépenses IA estimées à 98 €, pour un budget de 150 €. Nous sommes dans le budget, avec une marge de 35 %. Le poste le plus important reste la génération de sites.',
        date: rel(-1, 18),
      },
      { id: 'm2', from: 'me', text: 'Et le coût par restaurant ?', date: rel(-1, 18, 10) },
      { id: 'm3', from: 'agent', text: 'Environ 24 € par restaurant suivi ce mois-ci, à comparer à l’abonnement de 49 €/mois. Estimation uniquement, aucune donnée réelle n’est connectée.', date: rel(-1, 18, 11) },
    ],
    suggestions: ['Quel poste réduire en priorité ?', 'Projection à 10 restaurants', 'Où en est l’invitation de paiement du Petit Zinc ?'],
  },
  {
    id: 'conv-coord',
    agentId: AGENT.coord,
    projectId: PROJECT.yumco,
    title: 'Coordination générale',
    messages: [
      {
        id: 'm1',
        from: 'agent',
        text: 'Bonjour ! Ce matin : 1 sujet éditorial Yumco et 1 sujet Argos AI attendent ta validation. Une publication Facebook est en erreur.',
        date: rel(0, 8, 42),
      },
    ],
    suggestions: ['Prépare l’ordre du jour de la réunion éditoriale', 'Relance Green Bowl', 'Qu’est-ce qui est en retard ?'],
  },
];

/** Réponses simulées par agent : aucune IA n'est appelée. */
export const simulatedReplies: Record<string, string[]> = {
  [AGENT.dev]: [
    'Bien reçu. Je relance la suite de tests dès que le correctif est poussé (simulation).',
    'Noté. J’ajoute ce point au rapport de tests du dossier.',
  ],
  [AGENT.design]: [
    'Je prépare une variante et je te la soumets à validation (simulation).',
    'C’est noté dans la mémoire du restaurant pour les prochaines itérations.',
  ],
  [AGENT.com]: [
    'Je l’ajoute aux pistes de la semaine. Tu pourras valider le sujet depuis la page Communication.',
    'Bonne idée : je la garde pour la prochaine réunion éditoriale.',
  ],
  [AGENT.fin]: [
    'D’après l’estimation fictive, cela reste dans le budget mensuel.',
    'Je mets à jour l’estimation (données mockées).',
  ],
  [AGENT.coord]: [
    'C’est noté, je l’ajoute à l’ordre du jour de la prochaine réunion.',
    'Je crée un rappel et je préviens l’agent concerné (simulation).',
  ],
};

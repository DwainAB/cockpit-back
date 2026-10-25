import type {
  BuildStatus,
  DayHours,
  DayKey,
  DesignVersionStatus,
  OpeningHours,
  PostalAddress,
  QuestionnaireAnswers,
  SubscriptionPlan,
  TimeSlot,
  AgentAvailability,
  ContentFormat,
  ContentOriginType,
  ContentStatus,
  MeetingStatus,
  Network,
  ProductionStage,
  ProjectStatus,
  RestaurantStatus,
  StepStatus,
  StripeStatus,
  TaskPriority,
  TaskStatus,
  WorkflowStepKey,
} from './types';

/** Tons sémantiques partagés par tous les badges de statut. */
export type Tone = 'neutral' | 'info' | 'accent' | 'warning' | 'success' | 'danger' | 'muted';

export interface StatusMeta {
  label: string;
  tone: Tone;
}

type MetaMap<K extends string> = Record<K, StatusMeta>;

export const restaurantStatus: MetaMap<RestaurantStatus> = {
  prospect: { label: 'Prospect', tone: 'neutral' },
  pending: { label: 'En attente', tone: 'warning' },
  production: { label: 'En production', tone: 'info' },
  active: { label: 'Actif', tone: 'success' },
  suspended: { label: 'Suspendu', tone: 'danger' },
};

export const projectStatus: MetaMap<ProjectStatus> = {
  active: { label: 'En cours', tone: 'info' },
  paused: { label: 'En pause', tone: 'warning' },
  planned: { label: 'Planifié', tone: 'neutral' },
  done: { label: 'Terminé', tone: 'success' },
};

export const stepStatus: MetaMap<StepStatus> = {
  todo: { label: 'À venir', tone: 'muted' },
  in_progress: { label: 'En cours', tone: 'info' },
  awaiting_validation: { label: 'À valider', tone: 'accent' },
  changes_requested: { label: 'Modification demandée', tone: 'warning' },
  blocked: { label: 'Bloqué', tone: 'danger' },
  done: { label: 'Terminé', tone: 'success' },
  skipped: { label: 'Non requis', tone: 'muted' },
};

export const stripeStatus: MetaMap<StripeStatus> = {
  not_started: { label: 'Non commencé', tone: 'muted' },
  invite_to_send: { label: 'Invitation à envoyer', tone: 'warning' },
  info_pending: { label: 'Informations en attente', tone: 'info' },
  configured: { label: 'Configuré', tone: 'success' },
};

export const taskStatus: MetaMap<TaskStatus> = {
  todo: { label: 'À faire', tone: 'neutral' },
  in_progress: { label: 'En cours', tone: 'info' },
  awaiting_validation: { label: 'À valider', tone: 'accent' },
  blocked: { label: 'Bloquée', tone: 'danger' },
  done: { label: 'Terminée', tone: 'success' },
};

export const taskPriority: MetaMap<TaskPriority> = {
  low: { label: 'Basse', tone: 'muted' },
  medium: { label: 'Moyenne', tone: 'neutral' },
  high: { label: 'Haute', tone: 'warning' },
  urgent: { label: 'Urgente', tone: 'danger' },
};

export const contentStatus: MetaMap<ContentStatus> = {
  idea: { label: 'Idée', tone: 'muted' },
  preparing: { label: 'En préparation', tone: 'neutral' },
  topic_review: { label: 'Sujet à valider', tone: 'accent' },
  visual_review: { label: 'Visuel à valider', tone: 'accent' },
  approved: { label: 'Approuvé', tone: 'info' },
  scheduled: { label: 'Programmé', tone: 'info' },
  published: { label: 'Publié', tone: 'success' },
  error: { label: 'Erreur', tone: 'danger' },
};

export const meetingStatus: MetaMap<MeetingStatus> = {
  planned: { label: 'Planifiée', tone: 'neutral' },
  in_progress: { label: 'En cours', tone: 'info' },
  done: { label: 'Terminée', tone: 'success' },
};

export const availability: MetaMap<AgentAvailability> = {
  available: { label: 'Disponible', tone: 'success' },
  busy: { label: 'Occupé', tone: 'warning' },
  offline: { label: 'Hors ligne', tone: 'muted' },
};

export const networkLabel: Record<Network, string> = {
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  tiktok: 'TikTok',
};

export const networkColor: Record<Network, string> = {
  instagram: '#C13584',
  linkedin: '#0A66C2',
  facebook: '#1877F2',
  tiktok: '#111111',
};

export const formatLabel: Record<ContentFormat, string> = {
  image: 'Image',
  carousel: 'Carrousel',
  video: 'Vidéo',
  story: 'Story',
};

export const originLabel: Record<ContentOriginType, string> = {
  meeting: 'Idée de réunion',
  underexplored: 'Sujet peu abordé',
  trend: 'Tendance observée',
  manual: 'Idée manuelle',
};

export const workflowSteps: { key: WorkflowStepKey; label: string; description: string; isReview: boolean }[] = [
  { key: 'intake', label: 'Réception des informations', description: 'Collecte de la fiche restaurant, du menu, des photos et des accès.', isReview: false },
  { key: 'mockup', label: 'Création de la maquette', description: "L'agent webdesign prépare la structure et le zoning des pages.", isReview: false },
  { key: 'mockup_review', label: 'Validation de la maquette', description: 'Validation humaine de la maquette ou demande de modification.', isReview: true },
  { key: 'visual_dev', label: 'Développement du visuel', description: 'Application de la charte : typographies, couleurs, photos.', isReview: false },
  { key: 'visual_review', label: 'Validation du visuel', description: 'Validation humaine de la version visuelle du site.', isReview: true },
  { key: 'functional_dev', label: 'Développement des fonctionnalités', description: 'Menu dynamique, réservation, formulaire de contact, SEO local.', isReview: false },
  { key: 'tests', label: 'Tests automatiques', description: 'Suite de tests prédéfinis : responsive, formulaires, performances, liens.', isReview: false },
  { key: 'payment', label: 'Intégration du paiement', description: 'Configuration du paiement en ligne (mockée), si le restaurant le souhaite.', isReview: false },
  { key: 'delivery', label: 'Validation finale et livraison', description: 'Dernière relecture, mise en ligne et passage du client en actif.', isReview: true },
];

export const stepMeta = (key: WorkflowStepKey) => workflowSteps.find((s) => s.key === key)!;

export const productionStages: { key: ProductionStage; label: string }[] = [
  { key: 'new', label: 'En attente' },
  { key: 'mockup_prep', label: 'Maquette en préparation' },
  { key: 'mockup_review', label: 'Maquette à valider' },
  { key: 'development', label: 'Développement' },
  { key: 'tests', label: 'Tests automatiques' },
  { key: 'site_review', label: 'Site à valider' },
  { key: 'live', label: 'Livraison / actif' },
];

export const costCategoryLabel = {
  sites: 'Génération de sites',
  images: 'Images',
  videos: 'Vidéos',
  conversations: 'Conversations',
} as const;

export const dayLabels: Record<DayKey, string> = {
  mon: 'Lundi',
  tue: 'Mardi',
  wed: 'Mercredi',
  thu: 'Jeudi',
  fri: 'Vendredi',
  sat: 'Samedi',
  sun: 'Dimanche',
};

export const dayKeys = Object.keys(dayLabels) as DayKey[];

/** Suggestions pour le type de restaurant (saisie libre possible). */
export const restaurantTypes = [
  'Asiatique',
  'Japonais',
  'Chinois',
  'Thaïlandais',
  'Vietnamien',
  'Coréen',
  'Indien',
  'Italien',
  'Pizzeria',
  'Français / Bistrot',
  'Brasserie',
  'Gastronomique',
  'Méditerranéen',
  'Libanais',
  'Grec',
  'Mexicain',
  'Américain / Burger',
  'Fruits de mer',
  'Végétarien / Healthy',
  'Africain',
  'Crêperie',
  'Café / Salon de thé',
  'Boulangerie / Pâtisserie',
  'Food truck',
];

/** Polices proposées dans le questionnaire (Google Fonts). */
export const fontChoices = [
  { value: 'Playfair Display', label: 'Playfair Display — élégante, à empattements' },
  { value: 'Cormorant Garamond', label: 'Cormorant Garamond — raffinée, classique' },
  { value: 'DM Serif Display', label: 'DM Serif Display — affirmée, éditoriale' },
  { value: 'Lora', label: 'Lora — chaleureuse, lisible' },
  { value: 'Poppins', label: 'Poppins — moderne, arrondie' },
  { value: 'Montserrat', label: 'Montserrat — moderne, géométrique' },
  { value: 'Inter', label: 'Inter — sobre, neutre' },
  { value: 'Josefin Sans', label: 'Josefin Sans — vintage, aérée' },
  { value: 'Bebas Neue', label: 'Bebas Neue — impactante, en capitales' },
  { value: 'Pacifico', label: 'Pacifico — manuscrite, décontractée' },
  { value: 'Caveat', label: 'Caveat — écriture à la main, type ardoise' },
];

/** Horaires proposés par défaut : fermé le lundi, service midi et soir les autres jours. */
export const emptyHours = (): OpeningHours =>
  Object.fromEntries(
    dayKeys.map((d) => [d, d === 'mon' ? { closed: true, lunch: null, dinner: null } : { closed: false, lunch: { open: '12:00', close: '14:30' }, dinner: { open: '19:00', close: '22:30' } }]),
  ) as OpeningHours;

/** Services d'un jour ouvert, dans l'ordre (midi puis soir). */
export const daySlots = (d: DayHours): TimeSlot[] => (d.closed ? [] : [d.lunch, d.dinner].filter((s): s is TimeSlot => s !== null));

/** « 12:00 – 14:30 · 19:00 – 22:30 », ou « Fermé ». */
export const formatDayHours = (d: DayHours, separator = ' · ') => {
  const slots = daySlots(d);
  return slots.length ? slots.map((s) => `${s.open} – ${s.close}`).join(separator) : 'Fermé';
};

/** « 12 rue de la Paix, 75002 Paris » (pays omis s'il s'agit de la France). */
export const formatAddress = (a: PostalAddress) =>
  `${a.street}, ${a.postalCode} ${a.city}${a.country && !/^france$/i.test(a.country.trim()) ? `, ${a.country}` : ''}`;

export const subscriptionPlans: Record<SubscriptionPlan, { label: string; description: string }> = {
  starter: { label: 'Starter', description: 'Site, commande et réservation, sans assistant IA' },
  pro_ai: { label: 'Pro AI', description: 'Starter + assistant IA (150 demandes par mois)' },
  business_ai: { label: 'Business AI', description: 'Starter + assistant IA (500 demandes par mois)' },
};
export const subscriptionPlanKeys = Object.keys(subscriptionPlans) as SubscriptionPlan[];

export const designStatus: MetaMap<DesignVersionStatus> = {
  queued: { label: 'En attente', tone: 'neutral' },
  generating: { label: 'Maquette en préparation', tone: 'info' },
  ready: { label: 'Maquette à valider', tone: 'accent' },
  failed: { label: 'Échec', tone: 'danger' },
  validated: { label: 'Maquette validée', tone: 'success' },
};

export const buildStatus: MetaMap<BuildStatus> = {
  queued: { label: 'En attente du développeur', tone: 'neutral' },
  building: { label: 'Développement en cours', tone: 'info' },
  testing: { label: 'Tests automatiques', tone: 'info' },
  ready: { label: 'Site à valider', tone: 'accent' },
  failed: { label: 'Échec', tone: 'danger' },
  validated: { label: 'Site validé', tone: 'success' },
};

/* ---------- Accessibilité : contraste des couleurs (WCAG 2.1) ---------- */

const channel = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

/** Rapport de contraste entre deux couleurs hexadécimales (1 à 21). */
export const contrastRatio = (a: string, b: string) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
};

/** Seuils WCAG AA : 4,5 pour le texte courant, 3 pour le grand texte (≥ 24 px, ou ≥ 18,66 px en gras). */
export const contrastMinimum = (largeText: boolean) => (largeText ? 3 : 4.5);

const euros = (n: number) => `${n.toFixed(2).replace('.', ',').replace(',00', '')} €`;

/** Services du restaurant en phrases courtes, pour les agents design et développeur (contenu du site). */
export const serviceLines = (a: QuestionnaireAnswers): string[] => {
  const d = a.delivery;
  const lines = [
    a.onsite.enabled ? 'Service sur place' : 'Pas de service sur place',
    a.takesReservations ? 'Réservation en ligne' : 'Pas de réservation',
    a.onlineOrdering ? 'Commande en ligne' : 'Pas de commande en ligne',
  ];
  if (a.onlineOrdering && a.pickup) lines.push('Vente à emporter');
  if (a.onlineOrdering && d.enabled) {
    const when = d.lunch && d.dinner ? 'midi et soir' : d.lunch ? 'le midi' : 'le soir';
    const zones = d.zones.map((z) => `${z.fromKm}–${z.toKm} km : ${z.fee ? euros(z.fee) : 'offerte'}${z.freeFrom !== null ? `, offerte dès ${euros(z.freeFrom)}` : ''}`).join(' ; ');
    lines.push(`Livraison ${when}, jusqu'à ${d.maxKm} km (${zones})`);
  }
  if (a.menu.allYouCanEat) lines.push(`Formules à volonté : ${a.menu.formulas.map((f) => `${f.name} ${euros(f.price)}`).join(', ')}`);
  if (!a.menu.aLaCarte) lines.push('Pas de carte : formules à volonté uniquement');
  return lines;
};

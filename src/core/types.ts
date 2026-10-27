// Types métier de la plateforme. Ils décrivent la forme des données telle
// qu'une future API devra les renvoyer.

export type ISODate = string;

/* ---------- Agents ---------- */

/**
 * Spécialité de l'agent. Chaque spécialité définit en interne le modèle à utiliser
 * (voir `specialties.ts`) ; la liste est volontairement extensible.
 */
export type AgentKind =
  | 'coordinator'
  | 'webdesign'
  | 'developer'
  | 'commercial'
  | 'marketing'
  | 'seo'
  | 'copywriter'
  | 'graphist'
  | 'communication'
  | 'support'
  | 'analyst'
  | 'finance';
export type AgentAvailability = 'available' | 'busy' | 'offline';
export type AgentProvider = 'openrouter' | 'claude';

/** Modèle IA : fournisseur + identifiant chez ce fournisseur. */
export interface AgentModel {
  provider: AgentProvider;
  model: string;
}

/** Modèles d'un agent : l'un pour les tâches (maquettes, code…), l'autre pour les conversations. */
export interface AgentModels {
  task: AgentModel;
  chat: AgentModel;
}

export type AgentMemorySource = 'manual' | 'conversation' | 'meeting' | 'project';

/** Souvenir durable d'un agent, injecté dans son contexte par pertinence (RAG lexical). */
export interface AgentMemoryEntry {
  id: string;
  text: string;
  source: AgentMemorySource;
  /** Élément d'origine (conversation, réunion, projet…). */
  sourceId: string | null;
  /** Projet où le souvenir a été appris ; absent : souvenir général, valable pour tous les projets. */
  projectId?: string | null;
  createdAt: ISODate;
}

export interface AgentMemoryInput {
  text: string;
  source?: AgentMemorySource;
  sourceId?: string | null;
  projectId?: string | null;
}

export interface Agent {
  id: string;
  kind: AgentKind;
  name: string;
  availability: AgentAvailability;
  projectIds: string[];
  lastActivity: { date: ISODate; text: string };
  /** Problème déclaré manuellement. Les problèmes liés aux dossiers sont dérivés (voir useAgentIssues). */
  issue: string | null;
  color: string;
  /** Prompt de l'agent : son rôle et ses consignes permanentes. */
  instructions: string;
  /** Modèles IA : valeurs par défaut de la spécialité (voir `specialties.ts`), modifiables dans le cockpit. */
  models: AgentModels;
  /** Souvenirs de l'agent (voir `searchAgentMemories`). */
  memories: AgentMemoryEntry[];
}

export interface AgentInput {
  name: string;
  kind: AgentKind;
  /** Prompt de l'agent : son rôle et ses consignes permanentes. */
  instructions: string;
  projectIds: string[];
  /** Absent : modèles par défaut de la spécialité. */
  models?: AgentModels;
}

/** Auteur d'une action : moi, un agent (id) ou le système. */
export type Actor = 'me' | 'system' | string;

/* ---------- Projets ---------- */

export type ProjectStatus = 'active' | 'paused' | 'planned' | 'done';

/** Sections disponibles dans un projet. */
export type ProjectModule = 'restaurants' | 'production' | 'communication';

export interface MemoryNote {
  id: string;
  date: ISODate;
  text: string;
  source: 'meeting' | 'manual' | 'agent';
  sourceId?: string;
}

export interface Project {
  id: string;
  name: string;
  category: string;
  color: string;
  modules: ProjectModule[];
  status: ProjectStatus;
  summary: string;
  objective: string;
  owner: string;
  agentIds: string[];
  progress: number;
  dueDate: ISODate;
  lastActivity: { date: ISODate; text: string };
  memory: MemoryNote[];
  settings: { weeklyMeeting: boolean; requireValidation: boolean };
  /** Planning des réseaux sociaux (absent : désactivé, valeurs par défaut). */
  editorial?: EditorialPlan;
  /** Pistes de posts proposées par l'agent. */
  ideas?: PostIdea[];
}

/** Piste de post : proposée par l'agent, puis retenue (en réserve), écartée ou validée (devenue un post). */
export interface PostIdea {
  id: string;
  title: string;
  /** Pourquoi ce sujet. */
  reason: string;
  status: 'proposed' | 'kept' | 'dismissed' | 'validated';
  source: 'agent' | 'discussion' | 'manual';
  createdAt: ISODate;
  /** Post créé à la validation. */
  contentId?: string;
  /** Discussion éditoriale où l'agent l'a proposée. */
  conversationId?: string;
}

/** Planning éditorial d'un projet : jours de publication et discussion hebdomadaire avec l'agent. */
export interface EditorialPlan {
  enabled: boolean;
  /** Jours de publication (1 = lundi … 7 = dimanche). */
  days: number[];
  /** Heure de publication (HH:mm). */
  time: string;
  networks: Network[];
  /** Agent qui propose, crée et publie les posts. */
  agentId: string;
  /** Jour et heure où l'agent ouvre la discussion de la semaine. */
  briefDay: number;
  briefTime: string;
  /** Semaine (lundi, AAAA-MM-JJ) de la dernière discussion ouverte. */
  lastBriefWeek: string | null;
}

/** Idée de post retenue dans une discussion éditoriale. */
export interface EditorialIdea {
  title: string;
  objective: string;
  scheduledAt: ISODate;
}

/* ---------- Restaurants & production ---------- */

export type RestaurantStatus = 'prospect' | 'pending' | 'production' | 'active' | 'suspended';
export type StripeStatus = 'not_started' | 'invite_to_send' | 'info_pending' | 'configured';
export type BillingPlan = 'none' | 'trial' | 'subscribed';
/** État du site d’un restaurant (fiche `restaurant_sites` de Yumco). */
export type SiteStatus = 'design' | 'development' | 'online' | 'delivered';

export type WorkflowStepKey =
  | 'intake'
  | 'mockup'
  | 'mockup_review'
  | 'visual_dev'
  | 'visual_review'
  | 'functional_dev'
  | 'tests'
  | 'payment'
  | 'delivery';

export type StepStatus =
  | 'todo'
  | 'in_progress'
  | 'awaiting_validation'
  | 'changes_requested'
  | 'blocked'
  | 'done'
  | 'skipped';

export interface TestResult {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface StepComment {
  id: string;
  date: ISODate;
  author: Actor;
  text: string;
}

export interface WorkflowStep {
  key: WorkflowStepKey;
  status: StepStatus;
  date: ISODate | null;
  agentId: string;
  deliverable?: { label: string; kind: 'mockup' | 'visual' | 'build' | 'report' | 'form' };
  tests?: TestResult[];
  comments: StepComment[];
}

/** Colonnes du Kanban de production. */
export type ProductionStage =
  | 'new'
  | 'mockup_prep'
  | 'mockup_review'
  /** Développement visuel et fonctionnel réalisés en une seule fois. */
  | 'development'
  | 'tests'
  | 'site_review'
  | 'live';

export interface SocialLinks {
  instagram?: string;
  facebook?: string;
  tiktok?: string;
  linkedin?: string;
}

/* ---------- Questionnaire restaurateur ---------- */

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface TimeSlot {
  open: string; // HH:mm
  close: string; // HH:mm
}

/** Horaires d'un jour : fermé, ou un service le midi et/ou le soir (comme la table opening_hours de Yumco). */
export interface DayHours {
  closed: boolean;
  lunch: TimeSlot | null;
  dinner: TimeSlot | null;
}

export type OpeningHours = Record<DayKey, DayHours>;

/** Offre Yumco attribuée au restaurant (subscription_plan). La facturation reste gérée à la main. */
export type SubscriptionPlan = 'starter' | 'pro_ai' | 'business_ai';

/** Lien de questionnaire envoyé à un restaurateur (API Yumco, champs en snake_case comme l'API). */
export interface Invitation {
  id: number;
  subscription_plan: SubscriptionPlan;
  recipient_email: string | null;
  /** `submitted` : rempli, pas encore récupéré par le cockpit ; `imported` : dossier créé dans le cockpit. */
  status: 'pending' | 'submitted' | 'imported' | 'cancelled';
  restaurant_id: number | null;
  restaurant_name: string | null;
  expires_at: ISODate;
  submitted_at: ISODate | null;
  imported_at: ISODate | null;
  created_at: ISODate;
}

export interface UploadedFile {
  id: string;
  url: string;
  name: string;
}

export interface QuestionnaireImage {
  file: UploadedFile;
  /** Ce que représente l'image, pour que l'agent design sache où l'utiliser. */
  description: string;
}

export interface PostalAddress {
  street: string;
  postalCode: string;
  city: string;
  country: string;
}

/** Zone de livraison : de `fromKm` à `toKm`, frais `fee` €, gratuite à partir de `freeFrom` € de commande. */
export interface DeliveryZone {
  fromKm: number;
  toKm: number;
  fee: number;
  freeFrom: number | null;
}

/**
 * Réponses du questionnaire. Même schéma côté API Yumco (back-yumco-node, module onboarding), qui crée le restaurant
 * à partir de ces réponses : les deux sont à modifier ensemble.
 */
export interface QuestionnaireAnswers {
  name: string;
  restaurantType: string;
  address: PostalAddress;
  /** Coordonnées publiques du restaurant. */
  phone: string;
  email: string;
  /** Vide : pas de fiche Google. */
  googleReviewUrl: string;
  /** Gérant : son e-mail devient l'identifiant de son compte Yumco. */
  manager: { firstName: string; lastName: string; email: string; phone: string };
  hours: OpeningHours;
  /** Service sur place ; `tables` à 0 : les tables seront créées plus tard dans l'application. */
  onsite: { enabled: boolean; tables: number; seatsPerTable: number };
  takesReservations: boolean;
  onlineOrdering: boolean;
  /** Vente à emporter (seulement avec la commande en ligne). */
  pickup: boolean;
  /** Temps de préparation moyen, en minutes. */
  preparationTime: number;
  delivery: { enabled: boolean; lunch: boolean; dinner: boolean; maxKm: number; zones: DeliveryZone[] };
  menu: { aLaCarte: boolean; allYouCanEat: boolean; formulas: { name: string; price: number }[] };
  /** Souhait seulement : le paiement en ligne est activé à la main une fois le compte Stripe configuré. */
  wantsOnlinePayment: boolean;
  customRequests: string;
  logo: UploadedFile | null;
  /** Vide : l'équipe se charge des images. */
  images: QuestionnaireImage[];
  /** Champs vides : l'équipe se charge de la charte graphique. */
  branding: { colors: string[]; font: string | null };
}

/* ---------- Maquettes de site (génération du design) ---------- */

/** `queued` : en attente de prise en charge par l'agent. */
export type DesignVersionStatus = 'queued' | 'generating' | 'ready' | 'failed' | 'validated';

/** Direction artistique retenue par l'agent pour une version. */
export interface DesignConcept {
  name: string;
  summary: string;
  palette: string[];
  fonts: { heading: string; body: string };
}

/** Référencement défini par l'agent webdesign, mis en place par l'agent développeur. */
export interface SeoSpec {
  title: string;
  description: string;
  keywords: string[];
  ogDescription: string;
  /** Données structurées schema.org (Restaurant), en JSON. */
  jsonLd: string;
  /** Consignes techniques transmises à l'agent développeur (balises, performances, images…). */
  developerNotes?: string[];
}

/** Couple texte / fond déclaré par l'agent webdesign, vérifié automatiquement. */
export interface ContrastPair {
  usage: string;
  text: string;
  background: string;
  largeText: boolean;
}

/** Consommation d'une génération (estimée d'après le tarif du modèle). */
export interface DesignUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface DesignVersion {
  id: string;
  number: number;
  createdAt: ISODate;
  completedAt: ISODate | null;
  status: DesignVersionStatus;
  /** Remarque qui a motivé cette version (régénération), sinon `null`. */
  feedback: string | null;
  /** Nouvelle proposition complète plutôt que modification de la précédente. */
  fresh: boolean;
  concept: DesignConcept | null;
  /** Points d'attention de l'agent : demandes non réalisables, contenus d'exemple… */
  notes: string[];
  /** Sections du site (identifiants repris par l'IA développeuse). */
  sections: { id: string; purpose: string }[];
  /** Absent sur les maquettes générées avant l'ajout du référencement. */
  seo?: SeoSpec | null;
  /** Contrastes vérifiés (texte / fond), avec leur rapport. */
  contrasts?: (ContrastPair & { ratio: number; passed: boolean })[];
  /** Aperçu servi par l'API (mode API). */
  previewUrl: string | null;
  /** Code HTML conservé localement (mode démo uniquement). */
  html?: string;
  usage: DesignUsage | null;
  error: string | null;
  /** Aperçu simulé (aucune IA appelée). */
  simulated: boolean;
}

/* ---------- Développement du site (Next.js) ---------- */

/** queued → building (l'IA code) → testing (build + tests) → ready (à valider) → validated. */
export type BuildStatus = 'queued' | 'building' | 'testing' | 'ready' | 'failed' | 'validated';

export interface BuildCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface SiteBuild {
  id: string;
  number: number;
  /** Version de maquette validée à partir de laquelle le site est développé. */
  designVersionId: string;
  createdAt: ISODate;
  completedAt: ISODate | null;
  status: BuildStatus;
  /** Remarque qui a motivé ce développement (modification demandée), sinon `null`. */
  feedback: string | null;
  /** Tentatives de l'agent développeur (corrections automatiques après un test en échec). */
  attempts: number;
  checks: BuildCheck[];
  previewUrl: string | null;
  usage: DesignUsage | null;
  notes: string[];
  error: string | null;
  simulated: boolean;
}

/** Mise en ligne : envoi du code sur GitHub puis déploiement Vercel. */
export type DeliveryStatus = 'github' | 'vercel' | 'live' | 'failed';

export interface SiteDelivery {
  buildId: string;
  status: DeliveryStatus;
  repoUrl: string | null;
  siteUrl: string | null;
  /** Domaine officiel acheté, qui remplace l'adresse .vercel.app. */
  customDomain?: string | null;
  error: string | null;
  startedAt: ISODate;
  completedAt: ISODate | null;
  simulated: boolean;
}

/** Formulaire rempli, versions de maquette et développements associés. Ce n'est pas encore un restaurant. */
export interface SiteDraft {
  id: string;
  answers: QuestionnaireAnswers;
  /** Offre choisie (bouton du cockpit ou lien envoyé). */
  plan: SubscriptionPlan;
  /** Questionnaire rempli dans le cockpit, ou depuis un lien envoyé au restaurateur. */
  source: 'cockpit' | 'link';
  /** Restaurant créé dans la base Yumco à l'envoi du questionnaire (absent pour les anciens dossiers). */
  yumcoRestaurantId: number | null;
  /** Page du restaurant sur la plateforme Yumco (boutons Commander et Réserver). */
  platformUrl: string;
  createdAt: ISODate;
  updatedAt: ISODate;
  versions: DesignVersion[];
  builds: SiteBuild[];
  /** Absent tant qu'aucun site n'a été validé. */
  delivery?: SiteDelivery | null;
  /** Nom du dépôt GitHub et du projet Vercel (pré-rempli, modifiable avant la mise en ligne). */
  repoName?: string;
  /** Processus terminé : le dossier quitte la production et devient un restaurant. */
  finalizedAt?: ISODate | null;
  restaurantId?: string | null;
  /** Accès envoyés au gérant (e-mail avec mot de passe provisoire). */
  credentialsSentAt?: ISODate | null;
}

/** Résultat d'une génération, réelle ou simulée. */
export interface DesignResult {
  concept: DesignConcept;
  notes: string[];
  sections: { id: string; purpose: string }[];
  seo?: SeoSpec;
  contrasts?: (ContrastPair & { ratio: number; passed: boolean })[];
  html: string;
}

export interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  description: string;
  address: string;
  city: string;
  phone: string;
  email: string;
  contact: { name: string; role: string; email: string; phone: string };
  socials: SocialLinks;
  wantsOnlinePayment: boolean;
  services: { reservation: boolean; onlineOrdering: boolean };
  status: RestaurantStatus;
  billing: BillingPlan;
  stripeStatus: StripeStatus;
  createdAt: ISODate;
  updatedAt: ISODate;
  nextAction: string;
  internalNotes: string;
  agentId: string;
  blocker: string | null;
  workflow: WorkflowStep[];
  memory: MemoryNote[];
  accent: string;
  /** Site en ligne (domaine officiel) et code source, pour un restaurant issu de la production. */
  siteUrl?: string | null;
  repoUrl?: string | null;
  /** État du site dans la base Yumco ; `delivered` : site livré avant le suivi des statuts. */
  siteStatus?: SiteStatus;
}


export type WorkflowAction = 'validate' | 'request_changes' | 'block' | 'unblock';

/* ---------- Tâches ---------- */

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskStatus = 'todo' | 'in_progress' | 'awaiting_validation' | 'blocked' | 'done';

export type TaskRef =
  | { type: 'workflow'; restaurantId: string; stepKey: WorkflowStepKey }
  | { type: 'content'; contentId: string }
  | { type: 'meeting'; meetingId: string };

export interface TaskComment {
  id: string;
  date: ISODate;
  author: Actor;
  text: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  projectId: string;
  restaurantId?: string;
  agentId: string;
  priority: TaskPriority;
  dueDate: ISODate;
  status: TaskStatus;
  needsMyValidation: boolean;
  ref?: TaskRef;
  comments: TaskComment[];
  createdAt: ISODate;
}

export interface NewTaskInput {
  title: string;
  description: string;
  projectId: string;
  restaurantId?: string;
  agentId: string;
  priority: TaskPriority;
  dueDate: ISODate;
  needsMyValidation: boolean;
}

/* ---------- Communication ---------- */

export type Network = 'instagram' | 'linkedin' | 'facebook' | 'tiktok';
export type ContentFormat = 'image' | 'carousel' | 'video' | 'story';
export type ContentStatus =
  | 'idea'
  | 'preparing'
  | 'topic_review'
  | 'visual_review'
  | 'approved'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'error';

/** Résultat de la publication d'un post sur un réseau. */
export interface PublicationResult {
  status: 'published' | 'error';
  at: ISODate;
  /** Lien du post publié. */
  url?: string;
  error?: string;
}

export type ContentOriginType = 'meeting' | 'discussion' | 'underexplored' | 'trend' | 'manual';

export interface ContentAdaptation {
  network: Exclude<Network, 'tiktok'>;
  ratio: string;
  note: string;
}

export interface Content {
  id: string;
  title: string;
  objective: string;
  origin: { type: ContentOriginType; label: string; meetingId?: string };
  networks: Network[];
  format: ContentFormat;
  status: ContentStatus;
  scheduledAt: ISODate;
  projectId: string;
  restaurantId?: string;
  agentId: string;
  captions: Partial<Record<Network, string>>;
  /** Visuel maître (Instagram / LinkedIn / Facebook) et ses déclinaisons. */
  masterVisual?: { title: string; description: string; palette: string[]; adaptations: ContentAdaptation[] };
  /** Vidéo TikTok : format distinct, jamais dérivée du visuel maître. */
  video?: { title: string; duration: string; script: string[] };
  generations: number;
  errorMessage?: string;
  /** Image créée par l'agent (servie par l'API, adresse publique une fois le serveur en ligne). */
  image?: UploadedFile;
  /** Description de l'image (accessibilité, texte alternatif). */
  imageAlt?: string;
  /** Échec de la dernière création du post par l'agent. */
  generationError?: string;
  /** Résultat de la publication, réseau par réseau. */
  publications?: Partial<Record<Network, PublicationResult>>;
  history: { date: ISODate; text: string }[];
}

/** Retouches possibles avant publication : sujet, réseaux, textes par réseau et date de publication. */
export interface ContentUpdate {
  title?: string;
  objective?: string;
  networks?: Network[];
  captions?: Partial<Record<Network, string>>;
  scheduledAt?: ISODate;
}

export type ContentAction =
  | 'validate_topic'
  | 'another_idea'
  | 'validate_visual'
  | 'request_changes'
  | 'submit_topic'
  | 'retry'
  | 'publish_now';

export interface NewIdeaInput {
  projectId: string;
  title: string;
  objective: string;
  networks: Network[];
  format: ContentFormat;
  scheduledAt: ISODate;
}

/* ---------- Réunions ---------- */

export type MeetingStatus = 'planned' | 'in_progress' | 'done';

export interface TranscriptEntry {
  id: string;
  speaker: Actor;
  time: string;
  text: string;
}

export interface MeetingItem {
  id: string;
  text: string;
  taskId?: string;
  contentId?: string;
}

export interface Meeting {
  id: string;
  title: string;
  date: ISODate;
  /** `null` : réunion transverse qui englobe tous les projets. */
  projectId: string | null;
  agentIds: string[];
  objective: string;
  status: MeetingStatus;
  agenda: string[];
  transcript: TranscriptEntry[];
  decisions: MeetingItem[];
  ideas: MeetingItem[];
  followUps: MeetingItem[];
  memoryAdded: string[];
  tasksCreated: boolean;
}

export interface NewMeetingInput {
  title: string;
  date: ISODate;
  projectId: string | null;
  agentIds: string[];
  objective: string;
  agenda: string[];
  /** Démarre la réunion immédiatement au lieu de la planifier. */
  startNow: boolean;
}

/* ---------- Conversations ---------- */

export interface ChatMessage {
  id: string;
  from: 'me' | 'agent' | 'system';
  text: string;
  date: ISODate;
  attachment?: { name: string; kind: 'file' | 'image' | 'link' };
}

export interface Conversation {
  id: string;
  agentId: string;
  projectId: string;
  restaurantId?: string;
  title: string;
  messages: ChatMessage[];
  suggestions: string[];
  /** Discussion éditoriale de la semaine : dates à remplir et posts créés une fois les idées validées. */
  editorial?: { week: string; slots: ISODate[]; networks: Network[]; confirmedAt?: ISODate; contentIds: string[] };
}

export interface NewConversationInput {
  agentId: string;
  projectId: string;
  /** Nouvelle discussion même s'il en existe déjà une avec cet agent sur ce projet. */
  fresh?: boolean;
}

/* ---------- Notifications & activité ---------- */

export type NotificationType = 'validation' | 'alert' | 'info' | 'success';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  date: ISODate;
  read: boolean;
  link?: string;
}

export type ActivityType = 'agent_done' | 'restaurant_created' | 'submitted' | 'issue' | 'validated' | 'meeting' | 'task';

export interface Activity {
  id: string;
  type: ActivityType;
  actor: Actor;
  text: string;
  date: ISODate;
  link?: string;
}

/* ---------- Finance & paramètres ---------- */

export type CostCategory = 'sites' | 'images' | 'videos' | 'conversations';

export interface MonthlyFinance {
  month: string;
  revenue: number;
  costs: number;
}

export interface ProjectFinance {
  projectId: string;
  /** Source des revenus suivis, ou `null` si le projet n'en a pas encore. */
  revenueSource: string | null;
  monthly: MonthlyFinance[];
  costsByCategory: Record<CostCategory, number>;
  budget: number;
}

export interface FinanceData {
  subscriptionPrice: number;
  projects: ProjectFinance[];
}

export interface Automation {
  id: string;
  projectId: string | null;
  name: string;
  description: string;
  schedule: string;
  enabled: boolean;
}

/** Tâches IA du flux de création de site, chacune confiée à un agent choisi dans le cockpit. */
export type SiteTask = 'design' | 'development';

export interface Settings {
  profile: { name: string; email: string; role: string; timezone: string };
  /** Agent qui réalise chaque tâche IA du flux de création de site (Paramètres → Agents IA). */
  siteAgents: Record<SiteTask, string>;
  notifications: Record<'validations' | 'alerts' | 'weeklyReport' | 'publications', boolean>;
  automations: Automation[];
  budget: { monthlyLimit: number; maxGenerationsPerContent: number; alertThreshold: number };
}

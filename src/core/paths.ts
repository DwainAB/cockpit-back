/** Identifiants des projets gérés par le cockpit. */
export const PROJECT_IDS = { yumco: 'yumco', argos: 'argos', diagnoskin: 'diagnoskin' } as const;

/** Plateforme de commande et de réservation Yumco. */
export const PLATFORM_BASE_URL = 'https://platform.yumco.fr';
/** Restaurant actif utilisé pour les tests (l'identifiant deviendra propre à chaque restaurant). */
export const TEST_PLATFORM_RESTAURANT_ID = 'yumco-restaurant-6';
export const platformUrl = (restaurantId: string, base = PLATFORM_BASE_URL) => `${base.replace(/\/$/, '')}/${restaurantId}`;

/** Les restaurants et la production des sites appartiennent toujours à Yumco. */
export const RESTAURANT_PROJECT = PROJECT_IDS.yumco;

/** URL de l'interface, partagées par le frontend, les notifications et l'historique d'activité. */
export const paths = {
  home: () => '/',
  discussions: (threadId?: string) => (threadId ? `/discussions/${threadId}` : '/discussions'),
  tasks: (taskId?: string) => (taskId ? `/tasks?task=${taskId}` : '/tasks'),
  finance: (projectId?: string) => (projectId ? `/p/${projectId}/finance` : '/finance'),
  agents: (agentId?: string) => (agentId ? `/agents?agent=${agentId}` : '/agents'),
  settings: () => '/settings',
  project: (projectId: string) => `/p/${projectId}`,
  restaurants: () => `/p/${RESTAURANT_PROJECT}/restaurants`,
  restaurant: (id: string) => `/p/${RESTAURANT_PROJECT}/restaurants/${id}`,
  production: () => `/p/${RESTAURANT_PROJECT}/production`,
  workflow: (restaurantId: string) => `/p/${RESTAURANT_PROJECT}/production/${restaurantId}`,
  newDraft: () => `/p/${RESTAURANT_PROJECT}/production/nouveau`,
  draft: (id: string) => `/p/${RESTAURANT_PROJECT}/production/${id}`,
  communication: (projectId: string) => `/p/${projectId}/communication`,
  content: (projectId: string, contentId: string) => `/p/${projectId}/communication/${contentId}`,
};

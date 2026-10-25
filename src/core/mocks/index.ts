import { createAgents } from './agents';
import { createSettings } from './misc';
import { createProjects } from './projects';
import type { Activity, AppNotification, Content, Conversation, Meeting, Restaurant, SiteDraft, Task } from '../types';

/**
 * Données d'une base du cockpit vide : agents, projets et réglages (configuration), le reste démarre vide.
 * Les restaurants viennent de la base Yumco.
 */
export const createSeed = () => ({
  agents: createAgents(),
  projects: createProjects(),
  restaurants: <Restaurant[]>[],
  tasks: <Task[]>[],
  contents: <Content[]>[],
  meetings: <Meeting[]>[],
  conversations: <Conversation[]>[],
  notifications: <AppNotification[]>[],
  activities: <Activity[]>[],
  finance: { subscriptionPrice: 49, projects: [] },
  settings: createSettings(),
  drafts: <SiteDraft[]>[],
});

export type Seed = ReturnType<typeof createSeed>;

export { simulatedReplies } from './conversations';
export { DEFAULT_STEP_AGENTS, standardTests } from './restaurants';
export { AGENT } from './agents';
export { PROJECT } from './projects';

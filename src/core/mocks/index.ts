import { createAgents } from './agents';
import { createContents } from './contents';
import { createConversations } from './conversations';
import { createMeetings } from './meetings';
import { createActivities, createFinance, createNotifications, createSettings } from './misc';
import { createProjects } from './projects';
import { createRestaurants } from './restaurants';
import { createTasks } from './tasks';
import type { SiteDraft } from '../types';

/** Jeu de données complet. Remplacé plus tard par les réponses de l'API. */
export const createSeed = () => ({
  agents: createAgents(),
  projects: createProjects(),
  restaurants: createRestaurants(),
  tasks: createTasks(),
  contents: createContents(),
  meetings: createMeetings(),
  conversations: createConversations(),
  notifications: createNotifications(),
  activities: createActivities(),
  finance: createFinance(),
  settings: createSettings(),
  drafts: <SiteDraft[]>[],
});

export type Seed = ReturnType<typeof createSeed>;

export { simulatedReplies } from './conversations';
export { DEFAULT_STEP_AGENTS, standardTests } from './restaurants';
export { AGENT } from './agents';
export { PROJECT } from './projects';

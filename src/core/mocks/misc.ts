import type { Activity, AppNotification, FinanceData, Settings } from '../types';
import { dayjs, rel } from '../dates';
import { paths } from '../paths';
import { AGENT } from './agents';

export const createNotifications = (): AppNotification[] => [
  { id: 'n-3', type: 'validation', title: 'Sujet à valider', body: 'Yumco · Les producteurs locaux derrière nos restaurants.', date: rel(-1, 17, 21), read: false, link: paths.content('yumco', 'content-producteurs') },
  { id: 'n-4', type: 'alert', title: 'Publication en erreur', body: 'Yumco · Facebook — menu d’automne Nonna Lucia (simulation).', date: rel(-1, 18), read: false, link: paths.content('yumco', 'content-menu-automne') },
  { id: 'n-7', type: 'validation', title: 'Sujet à valider', body: 'Argos AI · Argos AI en 30 secondes.', date: rel(-2, 15), read: false, link: paths.content('argos', 'content-argos-intro') },
  { id: 'n-5', type: 'info', title: 'Réunion demain', body: 'Réunion éditoriale Yumco à 10:00.', date: rel(0, 8), read: true, link: paths.discussions('meet-edito-2') },
];

export const createActivities = (): Activity[] => [
  { id: 'a-2', type: 'agent_done', actor: AGENT.coord, text: 'a terminé le brouillon du rapport hebdomadaire', date: rel(0, 8, 42), link: paths.tasks() },
  { id: 'a-4', type: 'issue', actor: 'system', text: 'Publication Facebook en erreur : menu d’automne Nonna Lucia', date: rel(-1, 18), link: paths.content('yumco', 'content-menu-automne') },
  { id: 'a-5', type: 'submitted', actor: AGENT.com, text: 'a soumis le sujet « Producteurs locaux » à validation', date: rel(-1, 17, 21), link: paths.content('yumco', 'content-producteurs') },
  { id: 'a-9', type: 'submitted', actor: AGENT.com, text: 'a proposé le premier sujet Argos AI', date: rel(-2, 15), link: paths.content('argos', 'content-argos-intro') },
  { id: 'a-8', type: 'meeting', actor: AGENT.coord, text: 'a archivé le compte rendu du point production', date: rel(-3, 15), link: paths.discussions('meet-prod') },
];

const monthLabel = (offset: number) => dayjs().subtract(offset, 'month').format('MMM YY');
const months = (values: [number, number][]) => values.map(([revenue, costs], i) => ({ month: monthLabel(values.length - 1 - i), revenue, costs }));

export const createFinance = (): FinanceData => ({
  subscriptionPrice: 49,
  projects: [
    {
      projectId: 'yumco',
      revenueSource: 'Abonnements restaurants (49 €/mois)',
      monthly: months([[0, 22], [0, 31], [49, 40], [49, 58], [98, 66], [147, 78]]),
      costsByCategory: { sites: 41, images: 15, videos: 10, conversations: 12 },
      budget: 120,
    },
    {
      projectId: 'argos',
      revenueSource: null,
      monthly: months([[0, 0], [0, 0], [0, 0], [0, 3], [0, 6], [0, 9]]),
      costsByCategory: { sites: 0, images: 5, videos: 0, conversations: 4 },
      budget: 30,
    },
    {
      projectId: 'diagnoskin',
      revenueSource: null,
      monthly: months([[0, 0], [0, 0], [0, 0], [0, 0], [0, 4], [0, 11]]),
      costsByCategory: { sites: 0, images: 3, videos: 7, conversations: 1 },
      budget: 30,
    },
  ],
});

export const createSettings = (): Settings => ({
  profile: { name: 'Alex Martin', email: 'alex@cockpit.example', role: 'Direction', timezone: 'Europe/Paris' },
  notifications: { validations: true, alerts: true, weeklyReport: true, publications: false },
  automations: [
    { id: 'auto-1', projectId: null, name: 'Proposition éditoriale du lundi', description: 'L’agent communication propose les sujets de la semaine chaque lundi à 9:00, pour chaque projet.', schedule: 'Chaque lundi · 09:00', enabled: true },
    { id: 'auto-2', projectId: 'yumco', name: 'Deux publications par semaine', description: 'Rythme cible de publication, réparti mardi et jeudi.', schedule: 'Mardi & jeudi', enabled: true },
    { id: 'auto-3', projectId: null, name: 'Validation avant publication', description: 'Aucun contenu n’est programmé sans validation humaine du sujet et du visuel.', schedule: 'Toujours', enabled: true },
    { id: 'auto-4', projectId: null, name: 'Rapport hebdomadaire des agents', description: 'Synthèse des étapes, blocages et dépenses estimées.', schedule: 'Chaque vendredi · 17:00', enabled: true },
    { id: 'auto-5', projectId: null, name: 'Limite de générations par contenu', description: 'Au-delà de 3 générations de visuel, une validation est demandée.', schedule: 'Par contenu', enabled: false },
  ],
  budget: { monthlyLimit: 180, maxGenerationsPerContent: 3, alertThreshold: 80 },
});

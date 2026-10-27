import { z } from 'zod';
import { MEMORY_MAX_LENGTH, SPECIALTY_IDS } from './core';

const text = (max = 2000) => z.string().trim().min(1).max(max);
const optionalText = (max = 2000) => z.string().trim().max(max).default('');
const isoDate = z.string().datetime({ offset: true });
const email = z.string().trim().email();

export const workflowStepKey = z.enum(['intake', 'mockup', 'mockup_review', 'visual_dev', 'visual_review', 'functional_dev', 'tests', 'payment', 'delivery']);
export const network = z.enum(['instagram', 'linkedin', 'facebook', 'tiktok']);

export const note = z.object({ text: text() });
export const stripeStatus = z.object({ status: z.enum(['not_started', 'invite_to_send', 'info_pending', 'configured']) });
export const workflowActionBody = z.object({ action: z.enum(['validate', 'request_changes', 'block', 'unblock']), comment: z.string().trim().max(2000).optional() });

export const newTask = z.object({
  title: text(200),
  description: optionalText(),
  projectId: text(80),
  restaurantId: z.string().optional(),
  agentId: text(80),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  dueDate: isoDate,
  needsMyValidation: z.boolean().default(false),
});
export const taskStatus = z.object({ status: z.enum(['todo', 'in_progress', 'awaiting_validation', 'blocked', 'done']) });

export const newIdea = z.object({
  projectId: text(80),
  title: text(200),
  objective: optionalText(),
  networks: z.array(network).min(1),
  format: z.enum(['image', 'carousel', 'video', 'story']),
  scheduledAt: isoDate,
});
export const contentActionBody = z.object({
  action: z.enum(['submit_topic', 'validate_topic', 'another_idea', 'validate_visual', 'request_changes', 'retry', 'publish_now']),
  comment: z.string().trim().max(2000).optional(),
});
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure au format HH:mm');
export const editorialPatch = z
  .object({
    enabled: z.boolean(),
    days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    time: hhmm,
    // TikTok viendra avec la génération de vidéos.
    networks: z.array(z.enum(['instagram', 'facebook', 'linkedin'])).min(1),
    agentId: text(80),
    briefDay: z.number().int().min(1).max(7),
    briefTime: hhmm,
  })
  .partial();
export const editorialIdeas = z.object({
  ideas: z.array(z.object({ title: text(200), objective: optionalText(1000), scheduledAt: isoDate })).min(1).max(7),
});

export const newPostIdea = z.object({ title: text(200), reason: optionalText(500) });
export const ideaLink = z.object({ conversationId: text(80) });
export const ideaStatus = z.object({ status: z.enum(['proposed', 'kept', 'dismissed']) });
export const ideaValidation = z.object({ scheduledAt: isoDate });

export const contentPatch = z.object({
  title: text(200).optional(),
  objective: z.string().trim().max(2000).optional(),
  networks: z.array(z.enum(['instagram', 'facebook', 'linkedin'])).min(1).optional(),
  captions: z.record(network, z.string().max(5000)).optional(),
  scheduledAt: isoDate.optional(),
});

export const newMeeting = z.object({
  title: text(200),
  date: isoDate,
  /** `null` : réunion transverse à tous les projets. */
  projectId: text(80).nullable(),
  agentIds: z.array(z.string()).min(1),
  objective: optionalText(),
  agenda: z.array(text(300)).default([]),
  startNow: z.boolean().default(false),
});
export const newConversation = z.object({ agentId: text(80), projectId: text(80), fresh: z.boolean().optional() });

const agentModel = z.object({ provider: z.enum(['claude', 'openrouter']), model: text(120) });

const agentFields = {
  name: text(80),
  kind: z.enum(SPECIALTY_IDS),
  instructions: optionalText(4000),
  projectIds: z.array(z.string()).default([]),
  models: z.object({ task: agentModel, chat: agentModel }).optional(),
};
export const newAgent = z.object(agentFields);
export const agentPatch = z.object(agentFields).partial();

export const agentMemory = z.object({
  text: text(MEMORY_MAX_LENGTH),
  source: z.enum(['manual', 'conversation', 'meeting', 'project']).default('manual'),
  sourceId: z.string().max(80).nullable().default(null),
});
export const agentMemoryPatch = z.object({ text: text(MEMORY_MAX_LENGTH) });
export const meetingStatus = z.object({ status: z.enum(['planned', 'in_progress', 'done']) });
export const meetingItem = z.object({ kind: z.enum(['decisions', 'ideas', 'followUps']), text: text(500) });

export const projectSetting = z.object({ key: z.enum(['weeklyMeeting', 'requireValidation']) });

export const chatMessage = z.object({
  text: text(4000),
  attachment: z.object({ name: text(200), kind: z.enum(['file', 'image', 'link']) }).optional(),
});

export const settingsPatch = z
  .object({
    profile: z.object({ name: text(120), email, role: optionalText(120), timezone: text(60) }),
    siteAgents: z.object({ design: text(80), development: text(80) }),
    notifications: z.object({ validations: z.boolean(), alerts: z.boolean(), weeklyReport: z.boolean(), publications: z.boolean() }),
    budget: z.object({
      monthlyLimit: z.number().min(0).max(100000),
      maxGenerationsPerContent: z.number().int().min(1).max(20),
      alertThreshold: z.number().min(0).max(100),
    }),
  })
  .partial();

/* Questionnaire restaurateur : même schéma que l'API Yumco (back-yumco-node, onboarding.schemas.ts), à modifier ensemble. */

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure au format HH:mm');
const service = z.object({ open: time, close: time }).refine((s) => s.open !== s.close, 'Heures d’ouverture et de fermeture identiques').nullable();
const day = z.object({ closed: z.boolean(), lunch: service, dinner: service });
const dayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
/** Seuls les fichiers envoyés à cette API sont acceptés (pas d'URL externe arbitraire). */
const uploadedFile = z.object({
  id: text(80),
  url: z.string().regex(/^\/api\/uploads\/[a-z0-9-]+\.(png|jpg|webp)$/, 'Fichier invalide'),
  name: z.string().trim().max(200),
});
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur au format #RRGGBB');
const lowerEmail = email.toLowerCase().max(254);
const deliveryZone = z
  .object({
    fromKm: z.number().int().min(0).max(100),
    toKm: z.number().int().min(1).max(100),
    fee: z.number().min(0).max(100),
    freeFrom: z.number().positive().max(10_000).nullable(),
  })
  .refine((zone) => zone.toKm > zone.fromKm, { message: 'La distance de fin doit être supérieure à celle de début', path: ['toKm'] });

export const subscriptionPlan = z.enum(['starter', 'pro_ai', 'business_ai']);

export const questionnaireAnswers = z
  .object({
    name: text(120),
    restaurantType: text(120),
    address: z.object({ street: text(200), postalCode: text(20), city: text(120), country: text(80) }),
    phone: text(40),
    email: lowerEmail,
    googleReviewUrl: z.union([z.literal(''), z.string().trim().url().max(500).startsWith('https://')]).default(''),
    manager: z.object({ firstName: text(80), lastName: text(80), email: lowerEmail, phone: text(40) }),
    hours: z.object({ mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day }),
    onsite: z.object({ enabled: z.boolean(), tables: z.number().int().min(0).max(200), seatsPerTable: z.number().int().min(1).max(30) }),
    takesReservations: z.boolean(),
    onlineOrdering: z.boolean(),
    pickup: z.boolean(),
    preparationTime: z.number().int().min(5).max(180),
    delivery: z.object({ enabled: z.boolean(), lunch: z.boolean(), dinner: z.boolean(), maxKm: z.number().int().min(1).max(100), zones: z.array(deliveryZone).max(10) }),
    menu: z.object({
      aLaCarte: z.boolean(),
      allYouCanEat: z.boolean(),
      formulas: z.array(z.object({ name: text(80), price: z.number().positive().max(1000) })).max(10),
    }),
    wantsOnlinePayment: z.boolean(),
    customRequests: optionalText(4000),
    logo: uploadedFile.nullable(),
    images: z.array(z.object({ file: uploadedFile, description: text(300) })).max(15),
    branding: z.object({ colors: z.array(hexColor).max(3), font: z.string().trim().max(80).nullable() }),
  })
  .superRefine((a, ctx) => {
    const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path });
    if (dayKeys.every((key) => a.hours[key].closed)) issue('Le restaurant doit être ouvert au moins un jour', ['hours']);
    for (const key of dayKeys) {
      const d = a.hours[key];
      if (!d.closed && !d.lunch && !d.dinner) issue('Jour ouvert sans service : indiquez le midi, le soir, ou « fermé »', ['hours', key]);
    }
    if (!a.menu.aLaCarte && !a.menu.allYouCanEat) issue('Choisissez « à la carte », « à volonté » ou les deux', ['menu']);
    if (a.menu.allYouCanEat && !a.menu.formulas.length) issue('Ajoutez au moins une formule à volonté', ['menu', 'formulas']);
    if (!a.onlineOrdering) return;
    if (!a.pickup && !a.delivery.enabled) issue('Commande en ligne : choisissez la vente à emporter, la livraison ou les deux', ['onlineOrdering']);
    if (!a.delivery.enabled) return;
    if (!a.delivery.lunch && !a.delivery.dinner) issue('Livraison : choisissez le midi, le soir ou les deux', ['delivery']);
    if (!a.delivery.zones.length) issue('Ajoutez au moins une zone de livraison', ['delivery', 'zones']);
    a.delivery.zones.forEach((zone, index) => {
      if (zone.toKm > a.delivery.maxKm) issue(`La zone dépasse la distance maximale (${a.delivery.maxKm} km)`, ['delivery', 'zones', index, 'toKm']);
      if (zone.freeFrom !== null && zone.fee === 0) issue('Livraison déjà gratuite : retirez le seuil de gratuité', ['delivery', 'zones', index, 'freeFrom']);
    });
    const sorted = [...a.delivery.zones].sort((x, y) => x.fromKm - y.fromKm);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].fromKm <= sorted[i - 1].toKm) {
        issue('Les zones de livraison ne doivent pas se chevaucher (ex. 0–3 km puis 4–6 km)', ['delivery', 'zones']);
        break;
      }
    }
  });
export const newDraftBody = z.object({ plan: subscriptionPlan, answers: questionnaireAnswers });
export const invitationBody = z.object({ plan: subscriptionPlan, email: lowerEmail.nullable().default(null) });
export const regenerateBody = z.object({ feedback: z.string().trim().max(2000).optional(), fresh: z.boolean().default(false) });
export const buildChangesBody = z.object({ feedback: z.string().trim().max(2000).optional() });
export const repoNameBody = z.object({ name: z.string().trim().min(1).max(100) });
export const domainBody = z.object({ domain: z.string().trim().min(3).max(253) });

/* ---------- Gestion d'un restaurant Yumco (carte, utilisateurs, commandes) ---------- */

export const categoryBody = z.object({ name: text(120), kind: z.enum(['main', 'starter', 'drink', 'side', 'dessert', 'other']).default('other') });
export const restaurantUserBody = z.object({
  first_name: text(100),
  last_name: text(100),
  email,
  phone: z.string().trim().max(30).nullable().optional(),
  role: z.enum(['owner', 'manager', 'staff']),
});
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const ordersQuery = z.object({
  status: z.enum(['pending', 'preparing', 'ready', 'completed', 'cancelled']).optional(),
  date_from: isoDay.optional(),
  date_to: isoDay.optional(),
});

/**
 * Restaurants : la base Yumco (inscription sur la plateforme) est la source.
 * Le cockpit y ajoute ses propres informations (notes, étapes, agent…), enregistrées dans sa base (restaurant_profiles).
 */
import { buildWorkflow, DEFAULT_STEP_AGENTS, formatAddress, type Restaurant, type SiteStatus } from './core';
import { yumcoDb } from './db';

/** Champs gérés par le cockpit ; tous les autres sont relus dans la base Yumco à chaque actualisation. */
const PROFILE_KEYS = ['status', 'billing', 'stripeStatus', 'nextAction', 'internalNotes', 'agentId', 'blocker', 'workflow', 'memory', 'accent', 'socials', 'description', 'updatedAt'] as const;
export type RestaurantProfile = Pick<Restaurant, (typeof PROFILE_KEYS)[number]>;

export const restaurantId = (yumcoId: number) => `yumco-${yumcoId}`;
export const yumcoIdOf = (id: string) => {
  const m = /^yumco-(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
};
export const profileOf = (r: Restaurant) => Object.fromEntries(PROFILE_KEYS.map((k) => [k, r[k]])) as RestaurantProfile;

interface Row {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  created_at: Date;
  subscription_status: string | null;
  stripe_charges_enabled: boolean | null;
  stripe_details_submitted: boolean | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  cuisine_type: string | null;
  wants_online_payment: boolean | null;
  manager_first_name: string | null;
  manager_last_name: string | null;
  manager_email: string | null;
  manager_phone: string | null;
  site_status: string | null;
  site_url: string | null;
  repo_url: string | null;
  owner_first_name: string | null;
  owner_last_name: string | null;
  owner_email: string | null;
  owner_phone: string | null;
  reservation: boolean | null;
  accept_orders: boolean | null;
  payment_online: boolean | null;
}

const QUERY = `
select r.id, r.name, r.phone, r.email, r.created_at, r.subscription_status, r.stripe_charges_enabled, r.stripe_details_submitted,
  a.street, a.postal_code, a.city, a.country,
  s.cuisine_type, s.wants_online_payment, s.manager_first_name, s.manager_last_name, s.manager_email, s.manager_phone,
  s.status as site_status, s.site_url, s.repo_url,
  o.first_name as owner_first_name, o.last_name as owner_last_name, o.email as owner_email, o.phone as owner_phone,
  c.reservation, c.accept_orders, c.payment_online
from restaurants r
left join addresses a on a.id = r.address_id
left join lateral (select * from restaurant_sites where restaurant_id = r.id order by id desc limit 1) s on true
left join lateral (
  select u.first_name, u.last_name, u.email, u.phone from roles ro join users u on u.id = ro.user_id
  where ro.restaurant_id = r.id and ro.type = 'owner' order by ro.id limit 1
) o on true
left join lateral (select * from restaurant_configs where restaurant_id = r.id order by id limit 1) c on true
where not coalesce(r.is_deleted, false)
order by r.created_at desc, r.id desc`;

/** Profil par défaut d'un restaurant que le cockpit ne connaît pas encore. */
const defaultProfile = (row: Row, createdAt: string): RestaurantProfile => {
  const online = row.site_status === 'online';
  const inProduction = row.site_status === 'design' || row.site_status === 'development';
  return {
    status: online || (!inProduction && row.subscription_status === 'active') ? 'active' : inProduction ? 'production' : 'pending',
    billing: 'none',
    stripeStatus: 'not_started',
    nextAction: online ? 'Point de suivi à 1 mois' : '',
    internalNotes: '',
    agentId: online ? DEFAULT_STEP_AGENTS.delivery : DEFAULT_STEP_AGENTS.intake,
    blocker: null,
    workflow: buildWorkflow(online ? 'all_done' : 'intake', {
      agents: DEFAULT_STEP_AGENTS,
      wantsPayment: Boolean(row.wants_online_payment ?? row.payment_online),
      startDaysAgo: 0,
      nowIso: () => createdAt,
    }),
    memory: [],
    accent: '#3B4A9E',
    socials: {},
    description: '',
    updatedAt: createdAt,
  };
};

const fullName = (first: string | null, last: string | null) => [first, last].filter(Boolean).join(' ');

const toRestaurant = (row: Row, profile: RestaurantProfile | undefined): Restaurant => {
  const createdAt = row.created_at.toISOString();
  const p = { ...defaultProfile(row, createdAt), ...profile };
  const manager = row.manager_email || row.manager_first_name;
  return {
    ...p,
    id: restaurantId(row.id),
    name: row.name,
    cuisine: row.cuisine_type ?? '',
    address: row.street ? formatAddress({ street: row.street, postalCode: row.postal_code ?? '', city: row.city ?? '', country: row.country ?? '' }) : '',
    city: row.city ?? '',
    phone: row.phone ?? '',
    email: row.email ?? '',
    contact: manager
      ? { name: fullName(row.manager_first_name, row.manager_last_name), role: 'Gérant', email: row.manager_email ?? '', phone: row.manager_phone ?? '' }
      : { name: fullName(row.owner_first_name, row.owner_last_name), role: 'Propriétaire', email: row.owner_email ?? '', phone: row.owner_phone ?? '' },
    wantsOnlinePayment: Boolean(row.wants_online_payment ?? row.payment_online),
    services: { reservation: Boolean(row.reservation), onlineOrdering: Boolean(row.accept_orders) },
    // Abonnement et Stripe : la base Yumco fait foi quand elle a l'information.
    billing: row.subscription_status === 'active' ? 'subscribed' : row.subscription_status === 'trialing' ? 'trial' : p.billing,
    stripeStatus: row.stripe_charges_enabled && row.stripe_details_submitted ? 'configured' : p.stripeStatus,
    createdAt,
    siteUrl: row.site_url,
    repoUrl: row.repo_url,
    // Pas de fiche de site : restaurant suivi avant les statuts, son site est considéré comme livré.
    siteStatus: (row.site_status as SiteStatus | null) ?? 'delivered',
  };
};

/** Restaurants Yumco (non supprimés), complétés par le profil cockpit de chacun. */
export const fetchYumcoRestaurants = async (profileFor: (yumcoId: number) => RestaurantProfile | undefined) => {
  const { rows } = await yumcoDb().query<Row>(QUERY);
  return rows.map((row) => toRestaurant(row, profileFor(row.id)));
};

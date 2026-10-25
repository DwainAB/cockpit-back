import { DomainError, type Invitation, type QuestionnaireAnswers, type SubscriptionPlan } from './core';
import { config } from './config';

/** Sans clé, le cockpit fonctionne en mode test : aucun restaurant n'est créé dans la base Yumco. */
export const yumcoEnabled = () => Boolean(config.yumcoApiKey);

export interface YumcoSubmission extends Invitation {
  /** Réponses du restaurateur, images sur Cloudinary. */
  answers: QuestionnaireAnswers;
  platform_url: string | null;
}

/** Message lisible à partir d'une erreur de l'API (`{"detail": "..."}` ou liste d'erreurs de validation). */
const describe = (body: unknown) => {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).slice(1).join('.')} : ${d.msg}`).join(' ; ');
  return 'réponse inattendue';
};

const call = async <T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> => {
  if (!yumcoEnabled()) throw new DomainError('API Yumco non configurée : renseignez YUMCO_API_KEY dans backend/.env.', 503);
  let res: Response;
  try {
    res = await fetch(`${config.yumcoApiUrl}${path}`, {
      method,
      headers: { 'x-cockpit-key': config.yumcoApiKey, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new DomainError(`API Yumco injoignable : ${(err as Error).message}`, 502);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new DomainError(`API Yumco (${res.status}) : ${describe(data)}`, res.status === 409 ? 409 : res.status === 422 ? 400 : 502);
  return data as T;
};

export const yumco = {
  /** Questionnaire rempli dans le cockpit : le restaurant est créé tout de suite avec l'offre choisie. */
  createRestaurant: (plan: SubscriptionPlan, answers: QuestionnaireAnswers) =>
    call<{ restaurant_id: number; platform_url: string }>('POST', '/onboarding/restaurants', { subscription_plan: plan, answers }),

  createInvitation: (plan: SubscriptionPlan, recipientEmail: string | null) =>
    call<Invitation & { url: string; email_sent: boolean; email_error: string | null }>('POST', '/onboarding/invitations', {
      subscription_plan: plan,
      recipient_email: recipientEmail,
    }),
  listInvitations: () => call<Invitation[]>('GET', '/onboarding/invitations'),
  cancelInvitation: (id: number) => call<void>('POST', `/onboarding/invitations/${id}/cancel`),

  listSubmissions: () => call<YumcoSubmission[]>('GET', '/onboarding/submissions'),
  markImported: (id: number) => call<void>('POST', `/onboarding/submissions/${id}/imported`),

  updateSite: (restaurantId: number, patch: { status?: 'design' | 'development' | 'online'; site_url?: string; repo_url?: string }) =>
    call<unknown>('PATCH', `/onboarding/restaurants/${restaurantId}/site`, patch),
  /** Crée le compte du gérant et lui envoie ses accès par e-mail. */
  sendCredentials: (restaurantId: number, siteUrl: string) =>
    call<{ account_created: boolean; credentials_sent_at: string }>('POST', `/onboarding/restaurants/${restaurantId}/credentials`, { site_url: siteUrl }),
};

/** Mise à jour de la fiche du site sans bloquer le parcours (l'erreur est seulement journalisée). */
export const syncSite = (restaurantId: number | null | undefined, patch: Parameters<typeof yumco.updateSite>[1]) => {
  if (!restaurantId || !yumcoEnabled()) return;
  yumco.updateSite(restaurantId, patch).catch((err) => console.error(`[yumco] fiche du site ${restaurantId} non mise à jour`, (err as Error).message));
};

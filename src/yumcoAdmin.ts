/**
 * Accès admin à l'API Yumco : depuis le cockpit, on aide un restaurateur (carte, utilisateurs, commandes)
 * en passant par les mêmes routes que ses applications, donc par les mêmes règles.
 */
import { DomainError } from './core';
import { config } from './config';
import { describe } from './yumco';

let token: string | null = null;

const statusOf = (status: number) => (status === 400 || status === 422 ? 400 : status === 403 || status === 404 || status === 409 ? status : 502);

const send = async (method: string, path: string, body: unknown, auth: string | null) => {
  try {
    return await fetch(`${config.yumcoApiUrl}${path}`, {
      method,
      headers: {
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
        ...(body === undefined || body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new DomainError(`API Yumco injoignable : ${(err as Error).message}`, 502);
  }
};

const login = async () => {
  if (!config.yumcoAdminEmail || !config.yumcoAdminPassword)
    throw new DomainError('Compte admin Yumco non configuré : renseignez YUMCO_ADMIN_EMAIL et YUMCO_ADMIN_PASSWORD dans backend/.env.', 503);
  const res = await send('POST', '/auth/login', { email: config.yumcoAdminEmail, password: config.yumcoAdminPassword }, null);
  const data = (await res.json().catch(() => null)) as { access_token?: string } | null;
  if (!res.ok || !data?.access_token) throw new DomainError('Connexion du compte admin Yumco refusée : vérifiez YUMCO_ADMIN_EMAIL et YUMCO_ADMIN_PASSWORD.', 503);
  token = data.access_token;
  return token;
};

/** Appel authentifié ; jeton expiré : nouvelle connexion puis un seul nouvel essai. */
export const adminCall = async <T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> => {
  let res = await send(method, path, body, token ?? (await login()));
  if (res.status === 401) res = await send(method, path, body, await login());
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new DomainError(`API Yumco (${res.status}) : ${describe(data)}`, statusOf(res.status));
  return data as T;
};

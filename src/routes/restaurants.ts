import { Router, type Request } from 'express';
import multer from 'multer';
import { addRestaurantNote, DomainError, setStripeStatus, workflowAction } from '../core';
import { config } from '../config';
import { handle, parse } from '../http';
import * as S from '../schemas';
import { store } from '../store';
import { adminCall } from '../yumcoAdmin';
import { yumcoIdOf } from '../yumcoRestaurants';

export const restaurants = Router();

restaurants.post(
  '/:id/notes',
  handle((req, res) => {
    const { text } = parse(S.note, req.body);
    res.json(store.mutate((ctx) => addRestaurantNote(ctx, req.params.id, text)));
  }),
);

restaurants.patch(
  '/:id/stripe',
  handle((req, res) => {
    const { status } = parse(S.stripeStatus, req.body);
    res.json(store.mutate((ctx) => setStripeStatus(ctx, req.params.id, status)));
  }),
);

restaurants.post(
  '/:id/workflow/:stepKey/actions',
  handle((req, res) => {
    const stepKey = parse(S.workflowStepKey, req.params.stepKey);
    const { action, comment } = parse(S.workflowActionBody, req.body);
    res.json(store.mutate((ctx) => workflowAction(ctx, req.params.id, stepKey, action, comment)));
  }),
);

/* ---------- Gestion du restaurant dans Yumco (compte admin du cockpit) ---------- */

/** Identifiant Yumco du restaurant de l'URL (`yumco-7` → 7). */
const yumcoRestaurant = (id: string) => {
  const rid = yumcoIdOf(id);
  if (rid === null) throw new DomainError('Ce restaurant n’est pas lié à la base Yumco.', 404);
  return rid;
};

const receiveImage = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 } }).single('image');

const PRODUCT_FIELDS = ['name', 'price', 'description', 'category_id', 'is_available', 'available_online', 'available_onsite', 'group'] as const;
/** Champs facultatifs qu'on peut vider. */
const CLEARABLE = new Set<string>(['description', 'group']);

/** Formulaire produit transmis tel quel à l'API Yumco (champs connus seulement, image comprise). */
const productForm = (req: Request) => {
  const form = new FormData();
  const body = req.body as Record<string, unknown>;
  for (const key of PRODUCT_FIELDS) {
    const value = body[key];
    if (typeof value === 'string' && (value !== '' || CLEARABLE.has(key))) form.append(key, value);
  }
  for (const allergen of ([] as unknown[]).concat(body.allergens ?? [])) if (typeof allergen === 'string' && allergen) form.append('allergens', allergen);
  if (req.file) form.append('image', new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype }), req.file.originalname);
  return form;
};

restaurants.get(
  '/:id/catalog',
  handle(async (req, res) => {
    const rid = yumcoRestaurant(req.params.id);
    const [categories, products, menus] = await Promise.all([
      adminCall('GET', `/restaurants/${rid}/categories`),
      adminCall('GET', `/restaurants/${rid}/products`),
      adminCall('GET', `/restaurants/${rid}/menus`),
    ]);
    res.json({ categories, products, menus });
  }),
);

restaurants.post(
  '/:id/categories',
  handle(async (req, res) => {
    res.status(201).json(await adminCall('POST', `/restaurants/${yumcoRestaurant(req.params.id)}/categories`, parse(S.categoryBody, req.body)));
  }),
);

restaurants.put(
  '/:id/categories/:categoryId',
  handle(async (req, res) => {
    const categoryId = Number(req.params.categoryId);
    res.json(await adminCall('PUT', `/restaurants/${yumcoRestaurant(req.params.id)}/categories/${categoryId}`, parse(S.categoryBody, req.body)));
  }),
);

restaurants.delete(
  '/:id/categories/:categoryId',
  handle(async (req, res) => {
    await adminCall('DELETE', `/restaurants/${yumcoRestaurant(req.params.id)}/categories/${Number(req.params.categoryId)}`);
    res.status(204).end();
  }),
);

restaurants.post(
  '/:id/products',
  receiveImage,
  handle(async (req, res) => {
    res.status(201).json(await adminCall('POST', `/restaurants/${yumcoRestaurant(req.params.id)}/products`, productForm(req)));
  }),
);

restaurants.put(
  '/:id/products/:productId',
  receiveImage,
  handle(async (req, res) => {
    res.json(await adminCall('PUT', `/restaurants/${yumcoRestaurant(req.params.id)}/products/${Number(req.params.productId)}`, productForm(req)));
  }),
);

/** Suppression logique côté Yumco : le produit disparaît de la carte, les anciennes commandes le gardent. */
restaurants.delete(
  '/:id/products/:productId',
  handle(async (req, res) => {
    await adminCall('DELETE', `/restaurants/${yumcoRestaurant(req.params.id)}/products/${Number(req.params.productId)}`);
    res.status(204).end();
  }),
);

interface YumcoUser {
  id: number;
  email: string;
  is_admin: boolean;
  roles: { restaurant_id: number; type: string }[];
}

/** Utilisateur rattaché à ce restaurant ; les comptes admin ne se gèrent jamais depuis une fiche restaurant. */
const restaurantUser = async (rid: number, userId: number) => {
  const users = await adminCall<YumcoUser[]>('GET', `/restaurants/${rid}/users`);
  const user = users.find((u) => u.id === userId);
  if (!user) throw new DomainError('Utilisateur introuvable dans ce restaurant.', 404);
  if (user.is_admin) throw new DomainError('Les comptes admin ne se gèrent pas depuis la fiche d’un restaurant.', 403);
  return user;
};

restaurants.get(
  '/:id/users',
  handle(async (req, res) => {
    res.json(await adminCall('GET', `/restaurants/${yumcoRestaurant(req.params.id)}/users`));
  }),
);

/** Le nouvel utilisateur reçoit son mot de passe provisoire par e-mail (API Yumco). */
restaurants.post(
  '/:id/users',
  handle(async (req, res) => {
    const body = parse(S.restaurantUserBody, req.body);
    res.status(201).json(await adminCall('POST', '/auth/register', { ...body, restaurant_id: yumcoRestaurant(req.params.id), is_admin: false }));
  }),
);

restaurants.put(
  '/:id/users/:userId',
  handle(async (req, res) => {
    const body = parse(S.restaurantUserBody, req.body);
    const user = await restaurantUser(yumcoRestaurant(req.params.id), Number(req.params.userId));
    res.json(await adminCall('PUT', `/auth/users/${user.id}`, body));
  }),
);

restaurants.delete(
  '/:id/users/:userId',
  handle(async (req, res) => {
    const rid = yumcoRestaurant(req.params.id);
    const user = await restaurantUser(rid, Number(req.params.userId));
    // La suppression est globale dans Yumco : on refuse si le compte sert aussi dans un autre restaurant.
    if (user.roles.some((r) => r.restaurant_id !== rid)) throw new DomainError('Ce compte est aussi rattaché à un autre restaurant : suppression refusée.', 409);
    await adminCall('DELETE', `/auth/users/${user.id}`);
    res.status(204).end();
  }),
);

/** Nouveau mot de passe provisoire envoyé par e-mail à l'utilisateur. */
restaurants.post(
  '/:id/users/:userId/reset-password',
  handle(async (req, res) => {
    const user = await restaurantUser(yumcoRestaurant(req.params.id), Number(req.params.userId));
    await adminCall('POST', `/auth/reset-password?email=${encodeURIComponent(user.email)}`);
    res.status(204).end();
  }),
);

/** Commandes (lecture seule pour l'instant), filtrées par statut et par période. */
restaurants.get(
  '/:id/orders',
  handle(async (req, res) => {
    const query = parse(S.ordersQuery, req.query);
    const params = new URLSearchParams(Object.entries(query).filter((e): e is [string, string] => Boolean(e[1])));
    res.json(await adminCall('GET', `/restaurants/${yumcoRestaurant(req.params.id)}/orders${params.size ? `?${params}` : ''}`));
  }),
);

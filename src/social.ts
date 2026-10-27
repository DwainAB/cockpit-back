/**
 * Posts des réseaux sociaux : l'agent du post crée les textes (modèle « Tâches ») et l'image (modèle d'images
 * d'OpenRouter), j'en valide le contenu, puis le planificateur les publie à la date prévue sur chaque réseau connecté.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as z from 'zod/v4';
import {
  completePost,
  type Content,
  duePosts,
  failPost,
  type Network,
  networkLabel,
  pendingNetworks,
  type PublicationResult,
  recordPublications,
  startPublishing,
} from './core';
import { claude, errorMessage, fallbackParams, responseText } from './claude';
import { config } from './config';
import { memoryContext } from './memorySearch';
import { openrouterImage, openrouterJson } from './openrouter';
import { store } from './store';
import { saveImage } from './uploads';

const NETWORKS = ['instagram', 'facebook', 'linkedin', 'tiktok'] as const;

/** Format accepté tel quel par les quatre réseaux pour une image seule. */
const IMAGE_ASPECT_RATIO = '4:5';
/** Intervalle de vérification des posts à publier. */
const SCHEDULER_MS = 60_000;

const PostOutput = z.object({
  captions: z.array(z.object({ network: z.enum(NETWORKS), text: z.string() })),
  imagePrompt: z.string(),
  imageAlt: z.string(),
  note: z.string(),
});

const SYSTEM_PROMPT = `Tu crées des posts de réseaux sociaux pour une agence. Pour chaque réseau demandé, tu écris un texte prêt à publier, adapté à ses usages :
- Instagram : accroche dès la première ligne, phrases courtes, quelques emojis, 5 à 10 hashtags pertinents à la fin (2 200 caractères au plus).
- Facebook : ton convivial et direct, une question ou un appel à l'action, 0 à 3 hashtags.
- LinkedIn : ton professionnel et concret, une idée forte par paragraphe, 3 hashtags au plus (1 300 caractères conseillés).
- TikTok (post photo) : texte très court et accrocheur, 3 à 5 hashtags.
Tu décris aussi l'image du post (imagePrompt), qui sera créée par un modèle d'images : scène, sujet, cadrage, lumière, ambiance et palette, au format portrait 4:5. Aucun texte, logo ni lettre dans l'image : le message passe par les textes du post.
imageAlt : description courte de l'image pour l'accessibilité. note : une phrase qui résume ton choix pour le studio.
Écris en français, sans fautes, sans inventer de chiffres, de prix ni de promesses.`;

const buildRequest = (c: Content, feedback: string | null) => {
  const project = store.snapshot.projects.find((p) => p.id === c.projectId);
  const restaurant = c.restaurantId ? store.snapshot.restaurants.find((r) => r.id === c.restaurantId) : null;
  return `<projet>${project ? `${project.name} — ${project.summary} Objectif : ${project.objective}` : c.projectId}</projet>${restaurant ? `\n<restaurant>${restaurant.name}</restaurant>` : ''}
<post>
Sujet : ${c.title}
Objectif : ${c.objective || 'non précisé'}
Format : ${c.format}
Réseaux : ${c.networks.map((n) => networkLabel[n]).join(', ')}
Publication prévue : ${new Date(c.scheduledAt).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Paris' })}
</post>${
    feedback
      ? `\n<version_precedente>\n${c.networks.map((n) => `${networkLabel[n]} :\n${c.captions[n] ?? ''}`).join('\n\n')}\n</version_precedente>\nLe studio demande cette modification : « ${feedback} ». Corrige le post en conséquence (textes et/ou image).`
      : ''
  }`;
};

/** Textes et description de l'image, avec le modèle « Tâches » de l'agent du post. */
const writePost = async (c: Content, feedback: string | null) => {
  const agent = store.snapshot.agents.find((a) => a.id === c.agentId);
  if (!agent) throw new Error('L’agent de ce post est introuvable (page Agents).');
  const system = `${SYSTEM_PROMPT}\n\nConsignes permanentes de l'agent (définies par le studio) :\n${await memoryContext(agent, `${c.title} ${c.objective} ${feedback ?? ''}`, c.projectId)}`;
  const content: Anthropic.Beta.BetaContentBlockParam[] = [{ type: 'text', text: buildRequest(c, feedback) }];
  const { provider, model } = agent.models.task;
  if (provider === 'openrouter') return (await openrouterJson({ model, system, content, schema: PostOutput, maxTokens: 16000, effort: 'medium' })).output;
  const stream = claude().beta.messages.stream({
    model,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: zodOutputFormat(PostOutput) },
    system,
    messages: [{ role: 'user', content }],
    ...fallbackParams(model),
  });
  return PostOutput.parse(JSON.parse(responseText(await stream.finalMessage())));
};

/** L'agent crée (ou corrige, avec ma remarque) le post : textes par réseau puis image. */
export const createPost = async (contentId: string, feedback: string | null = null) => {
  const c = store.snapshot.contents.find((x) => x.id === contentId);
  if (!c || c.status !== 'preparing') return;
  const started = Date.now();
  try {
    const out = await writePost(c, feedback);
    const captions: Partial<Record<Network, string>> = {};
    out.captions.filter((x) => c.networks.includes(x.network)).forEach((x) => (captions[x.network] = x.text.trim()));
    const image = await openrouterImage({ model: config.imageModel, prompt: out.imagePrompt, aspectRatio: IMAGE_ASPECT_RATIO });
    const file = saveImage(image.data, `post-${c.id}.png`);
    store.mutate(({ db }) => completePost(db, contentId, { captions, image: file, imageAlt: out.imageAlt, note: `Post ${feedback ? 'corrigé' : 'créé'} — ${out.note}` }));
    console.log(`[social] « ${c.title} » prêt en ${Math.round((Date.now() - started) / 1000)} s (image ${image.usage.model}, ~${image.usage.costUsd} $)`);
  } catch (err) {
    console.error(`[social] création de « ${c.title} » impossible`, err);
    store.mutate(({ db }) => failPost(db, contentId, errorMessage(err)));
  }
};

/**
 * Publication sur un réseau. Les connecteurs (Facebook, Instagram, LinkedIn, TikTok) sont branchés réseau par réseau ;
 * sans connecteur, la publication échoue avec un message explicite.
 */
type Publisher = (post: Content) => Promise<{ url?: string }>;
const publishers: Partial<Record<Network, Publisher>> = {};

export const publishPost = async (contentId: string) => {
  if (!store.mutate(({ db }) => startPublishing(db, contentId))) return;
  const c = store.snapshot.contents.find((x) => x.id === contentId)!;
  const results: Partial<Record<Network, PublicationResult>> = {};
  for (const network of pendingNetworks(c)) {
    const publish = publishers[network];
    try {
      if (!publish) throw new Error(`compte ${networkLabel[network]} non connecté (Paramètres → Réseaux sociaux)`);
      const { url } = await publish(c);
      results[network] = { status: 'published', at: new Date().toISOString(), url };
    } catch (err) {
      results[network] = { status: 'error', at: new Date().toISOString(), error: errorMessage(err) };
    }
  }
  store.mutate(({ db }) => recordPublications(db, contentId, results));
  console.log(`[social] « ${c.title} » : ${Object.entries(results).map(([n, r]) => `${n} ${r.status}`).join(', ')}`);
};

/** Planificateur : publie les posts programmés dont l'heure est venue (y compris ceux manqués pendant un arrêt). */
export const startSocialScheduler = () => {
  // Arrêt du serveur pendant une création ou une publication : rien ne reprend seul, le post l'indique.
  store.mutate(({ db }) => {
    db.contents.forEach((c) => {
      if (c.status === 'publishing') c.status = 'scheduled';
    });
    db.contents.filter((c) => c.status === 'preparing').forEach((c) => failPost(db, c.id, 'Création interrompue par un redémarrage du serveur. Relancez-la.'));
  });
  const tick = () => duePosts(store.snapshot).forEach((c) => void publishPost(c.id));
  tick();
  setInterval(tick, SCHEDULER_MS).unref();
};

/** Accès à l'API OpenRouter (compatible OpenAI) pour les agents réglés sur ce fournisseur. */
import type Anthropic from '@anthropic-ai/sdk';
import * as z from 'zod/v4';
import type { DesignUsage } from './core';
import { config } from './config';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

type Usage = { prompt_tokens?: number; completion_tokens?: number; cost?: number };
type ChatPart ={ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

/** Convertit les blocs du format Claude (texte, image base64) au format OpenAI. */
const toChatParts = (content: Anthropic.Beta.BetaContentBlockParam[]): ChatPart[] =>
  content.flatMap((b): ChatPart[] => {
    if (b.type === 'text') return [{ type: 'text', text: b.text }];
    if (b.type === 'image' && b.source.type === 'base64') return [{ type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } }];
    return [];
  });

/** Effort de raisonnement accepté par OpenRouter. */
const reasoningEffort = (effort: string) => (effort === 'low' || effort === 'medium' ? effort : 'high');

const httpError = async (res: Response) => {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  const detail = body?.error?.message;
  if (res.status === 401) return 'Clé API OpenRouter invalide ou absente (backend/.env).';
  if (res.status === 402) return 'Crédit insuffisant sur le compte OpenRouter.';
  if (res.status === 429) return 'Limite de requêtes OpenRouter atteinte (modèles gratuits limités). Réessayez dans un moment.';
  return `Erreur de l’API OpenRouter (${res.status})${detail ? ` : ${detail}` : '.'}`;
};

/** Génération d'une image (modèles d'images d'OpenRouter, payants à l'usage) : renvoie le fichier et la consommation. */
export const openrouterImage = async (opts: { model: string; prompt: string; aspectRatio: string }): Promise<{ data: Buffer; usage: DesignUsage }> => {
  if (!config.openrouterApiKey) throw new Error('Clé API OpenRouter absente (OPENROUTER_API_KEY dans backend/.env).');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openrouterApiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Cockpit' },
    body: JSON.stringify({
      model: opts.model,
      modalities: ['image', 'text'],
      image_config: { aspect_ratio: opts.aspectRatio },
      messages: [{ role: 'user', content: opts.prompt }],
    }),
    signal: AbortSignal.timeout(3 * 60 * 1000),
  }).catch((err: unknown) => {
    throw new Error(`Impossible de joindre l’API OpenRouter (${err instanceof Error ? err.message : 'erreur réseau'}).`);
  });
  if (!res.ok) throw new Error(await httpError(res));
  const body = (await res.json()) as {
    model?: string;
    error?: { message?: string };
    choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
    usage?: Usage;
  };
  if (body.error) throw new Error(`Erreur de l’API OpenRouter : ${body.error.message ?? 'inconnue'}`);
  const url = body.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? '';
  const match = /^data:image\/[a-z+]+;base64,(.+)$/s.exec(url);
  if (!match) throw new Error('Le modèle n’a renvoyé aucune image. Relancez.');
  return {
    data: Buffer.from(match[1], 'base64'),
    usage: {
      model: body.model ?? opts.model,
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
      costUsd: Math.round((body.usage?.cost ?? 0) * 10000) / 10000,
    },
  };
};

/** Réponse texte courte (conversations) : appel sans streaming. */
export const openrouterChat = async (opts: {
  model: string;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens: number;
}): Promise<{ text: string; usage: DesignUsage }> => {
  if (!config.openrouterApiKey) throw new Error('Clé API OpenRouter absente (OPENROUTER_API_KEY dans backend/.env).');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openrouterApiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Cockpit' },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens,
      reasoning: { exclude: true },
      messages: [{ role: 'system', content: opts.system }, ...opts.messages],
    }),
    signal: AbortSignal.timeout(3 * 60 * 1000),
  }).catch((err: unknown) => {
    throw new Error(`Impossible de joindre l’API OpenRouter (${err instanceof Error ? err.message : 'erreur réseau'}).`);
  });
  if (!res.ok) throw new Error(await httpError(res));
  const body = (await res.json()) as {
    model?: string;
    error?: { message?: string };
    choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
    usage?: Usage;
  };
  if (body.error) throw new Error(`Erreur de l’API OpenRouter : ${body.error.message ?? 'inconnue'}`);
  const choice = body.choices?.[0];
  const text = choice?.message?.content?.trim() ?? '';
  if (!text) throw new Error(choice?.finish_reason === 'length' ? 'Réponse trop longue, tronquée.' : 'Réponse vide de l’agent.');
  return {
    text,
    usage: {
      model: body.model ?? opts.model,
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
      costUsd: Math.round((body.usage?.cost ?? 0) * 10000) / 10000,
    },
  };
};

/** Appel en streaming (évite les coupures sur les longues générations), réponse JSON validée par `schema`. */
export const openrouterJson = async <T extends z.ZodType>(opts: {
  model: string;
  system: string;
  content: Anthropic.Beta.BetaContentBlockParam[];
  schema: T;
  maxTokens: number;
  effort: string;
}): Promise<{ output: z.infer<T>; usage: DesignUsage }> => {
  if (!config.openrouterApiKey) throw new Error('Clé API OpenRouter absente (OPENROUTER_API_KEY dans backend/.env).');
  const { $schema: _, ...jsonSchema } = z.toJSONSchema(opts.schema) as Record<string, unknown>;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openrouterApiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Cockpit' },
    body: JSON.stringify({
      model: opts.model,
      stream: true,
      max_tokens: opts.maxTokens,
      reasoning: { effort: reasoningEffort(opts.effort), exclude: true },
      response_format: { type: 'json_schema', json_schema: { name: 'result', strict: true, schema: jsonSchema } },
      provider: { require_parameters: true },
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: toChatParts(opts.content) },
      ],
    }),
    signal: AbortSignal.timeout(30 * 60 * 1000),
  }).catch((err: unknown) => {
    throw new Error(`Impossible de joindre l’API OpenRouter (${err instanceof Error ? err.message : 'erreur réseau'}).`);
  });
  if (!res.ok || !res.body) throw new Error(await httpError(res));

  let text = '';
  let model = opts.model;
  let finish: string | null = null;
  let usage: Usage | null = null;
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      // Les lignes « : OPENROUTER PROCESSING » maintiennent la connexion ouverte.
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      const event = JSON.parse(data) as {
        model?: string;
        error?: { message?: string };
        choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
        usage?: Usage;
      };
      if (event.error) throw new Error(`Erreur de l’API OpenRouter : ${event.error.message ?? 'inconnue'}`);
      if (event.model) model = event.model;
      if (event.usage) usage = event.usage;
      const choice = event.choices?.[0];
      if (choice?.delta?.content) text += choice.delta.content;
      if (choice?.finish_reason) finish = choice.finish_reason;
    }
  }
  if (finish === 'length') throw new Error('Réponse trop longue, tronquée. Relancez.');
  if (!text.trim()) throw new Error('Réponse vide de l’agent. Relancez.');

  // Certains modèles entourent le JSON d'un bloc de code malgré le format imposé.
  const json = text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  return {
    output: opts.schema.parse(JSON.parse(json)),
    usage: {
      model,
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      costUsd: Math.round((usage?.cost ?? 0) * 10000) / 10000,
    },
  };
};

/** Accès commun à l'API Claude pour les agents (webdesign, développeur). */
import Anthropic from '@anthropic-ai/sdk';
import * as z from 'zod/v4';
import type { DesignUsage } from './core';

/** Client créé au premier appel : le serveur démarre même sans clé API (mode simulé). */
let client: Anthropic | null = null;
export const claude = () => (client ??= new Anthropic());

/** Tarifs ($ par million de tokens, entrée / sortie) pour estimer le coût de chaque appel. */
const PRICING: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-opus-4-8': [5, 25],
};

/** Modèles acceptant la reprise automatique par un autre modèle en cas de refus (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-fable-5-1']);

/** Paramètres de reprise automatique, à ajouter à la requête quand le modèle les accepte. */
export const fallbackParams = (model: string) => (FALLBACK_MODELS.has(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {});

export const usageOf = (message: Anthropic.Beta.BetaMessage, requestedModel: string): DesignUsage => {
  const [inPrice, outPrice] = PRICING[message.model] ?? PRICING[requestedModel] ?? [0, 0];
  const inputTokens = message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0);
  const outputTokens = message.usage.output_tokens;
  return { model: message.model, inputTokens, outputTokens, costUsd: Math.round(((inputTokens * inPrice + outputTokens * outPrice) / 1_000_000) * 10000) / 10000 };
};

/** Additionne la consommation de plusieurs appels (corrections successives). */
export const addUsage = (a: DesignUsage | null, b: DesignUsage): DesignUsage =>
  a ? { model: b.model, inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, costUsd: Math.round((a.costUsd + b.costUsd) * 10000) / 10000 } : b;

/** Texte de la réponse, après vérification des cas d'arrêt anormaux. */
export const responseText = (message: Anthropic.Beta.BetaMessage) => {
  if (message.stop_reason === 'refusal') throw new Error('La demande a été refusée par le modèle.');
  if (message.stop_reason === 'max_tokens') throw new Error('Réponse trop longue, tronquée. Relancez.');
  return message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
};

export const errorMessage = (err: unknown) => {
  if (err instanceof Anthropic.AuthenticationError) return 'Clé API Claude invalide ou absente (backend/.env).';
  if (err instanceof Anthropic.RateLimitError) return 'Limite de requêtes de l’API Claude atteinte. Réessayez dans un moment.';
  if (err instanceof Anthropic.APIConnectionError) return 'Impossible de joindre l’API Claude.';
  if (err instanceof Anthropic.APIError) {
    const detail = (err.error as { error?: { message?: string } } | undefined)?.error?.message;
    if (detail?.includes('credit balance')) return 'Crédit insuffisant sur le compte Anthropic (console Anthropic → Plans & Billing).';
    return `Erreur de l’API Claude (${err.status ?? 'inconnue'})${detail ? ` : ${detail}` : '.'}`;
  }
  if (err instanceof z.ZodError || err instanceof SyntaxError) return 'Réponse de l’agent illisible. Relancez.';
  return err instanceof Error ? err.message : 'Erreur inconnue.';
};

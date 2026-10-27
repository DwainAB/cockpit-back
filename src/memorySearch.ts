/**
 * Recherche des souvenirs par le sens : chaque texte est transformé en vecteur (embedding) par un petit modèle
 * multilingue exécuté sur le serveur (gratuit, aucune donnée envoyée à l'extérieur), puis comparé à la requête.
 * Le score combine le sens et les mots communs ; sans modèle, la recherche par mots du core prend le relais.
 */
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { agentSystemContext, type Agent, type AgentMemoryEntry, MEMORY_CONTEXT_LIMIT, memoriesFor, searchAgentMemories, sharedWords } from './core';
import { config } from './config';

/** Choisi après comparaison sur des souvenirs en français (« Quelle teinte pour Nonna ? » → « vert olive… »). */
const MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
/**
 * En dessous, un souvenir n'est retenu que s'il partage des mots avec la requête (mesuré : souvenirs pertinents ≥ 0,38,
 * sans rapport jusqu'à ~0,31). Il doit aussi rester à moins de MAX_GAP du meilleur, pour ne pas joindre du bruit à un bon résultat.
 */
const MIN_SIMILARITY = 0.38;
const MAX_GAP = 0.2;
/** Bonus par mot significatif commun : un nom de restaurant ou de client pèse plus lourd. */
const WORD_BONUS = 0.15;
/** Au-delà, un nouveau souvenir redit un souvenir existant. */
const DUPLICATE_SIMILARITY = 0.85;
const CACHE_MAX = 5000;

env.cacheDir = config.modelsDir;

let embedder: Promise<FeatureExtractionPipeline | null> | null = null;
/** Vecteurs déjà calculés, par texte (les souvenirs changent peu). */
const cache = new Map<string, Float32Array>();

/** Charge le modèle une seule fois (téléchargé au premier lancement, ~130 Mo) ; `null` s'il est indisponible. */
const model = () =>
  (embedder ??= pipeline('feature-extraction', MODEL, { dtype: 'q8' }).catch((err: unknown) => {
    console.error('[mémoire] modèle d’embeddings indisponible, recherche par mots seulement :', err instanceof Error ? err.message : err);
    return null;
  }));

/** À appeler au démarrage : le premier appel d'un agent n'attend pas le chargement. */
export const warmUpMemorySearch = () =>
  void model().then((m) => m && console.log(`[mémoire] recherche par le sens prête (${MODEL})`));

const embed = async (extractor: FeatureExtractionPipeline, texts: string[]) => {
  const missing = [...new Set(texts.filter((t) => !cache.has(t)))];
  if (missing.length) {
    const output = await extractor(missing, { pooling: 'mean', normalize: true });
    const [, dims] = output.dims as [number, number];
    const data = output.data as Float32Array;
    if (cache.size + missing.length > CACHE_MAX) cache.clear();
    missing.forEach((t, i) => cache.set(t, data.slice(i * dims, (i + 1) * dims)));
  }
  return texts.map((t) => cache.get(t)!);
};

/** Vecteurs normalisés : le produit scalaire est la similarité cosinus. */
const similarity = (a: Float32Array, b: Float32Array) => a.reduce((sum, x, i) => sum + x * b[i], 0);

/** Similarités de la requête avec chaque souvenir donné, ou `null` sans modèle. */
const similarities = async (memories: AgentMemoryEntry[], query: string) => {
  const extractor = await model();
  if (!extractor) return null;
  try {
    const [q, ...vectors] = await embed(extractor, [query, ...memories.map((m) => m.text)]);
    return vectors.map((v) => similarity(q, v));
  } catch (err) {
    console.error('[mémoire] calcul des embeddings impossible, recherche par mots :', err instanceof Error ? err.message : err);
    return null;
  }
};

/**
 * Souvenirs les plus pertinents pour une requête : sens + mots communs, `limit` au plus.
 * Avec `projectId`, seulement ceux de ce projet et les souvenirs généraux : un agent ne mélange pas les projets.
 */
export const searchMemories = async (agent: Agent, query: string, limit = MEMORY_CONTEXT_LIMIT, projectId?: string | null): Promise<AgentMemoryEntry[]> => {
  const pool = memoriesFor(agent, projectId);
  if (!pool.length || !query.trim()) return searchAgentMemories(agent, query, limit, projectId);
  const scores = await similarities(pool, query);
  if (!scores) return searchAgentMemories(agent, query, limit, projectId);
  const best = Math.max(...scores);
  return pool
    .map((memory, i) => {
      const words = sharedWords(query, memory.text);
      const close = scores[i] >= MIN_SIMILARITY && scores[i] >= best - MAX_GAP;
      return { memory, keep: close || words > 0, score: scores[i] + WORD_BONUS * words };
    })
    .filter((s) => s.keep)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.memory);
};

/** Contexte système d'un agent (prompt + souvenirs pertinents), avec la recherche par le sens. */
export const memoryContext = async (agent: Agent, query: string, projectId?: string | null) =>
  agentSystemContext(agent, query, await searchMemories(agent, query, MEMORY_CONTEXT_LIMIT, projectId));

/** Le souvenir redit-il, avec d'autres mots, un souvenir que l'agent a déjà ? */
export const isKnownMemory = async (agent: Agent, text: string, projectId?: string | null) => {
  const pool = memoriesFor(agent, projectId);
  if (!pool.length) return false;
  const scores = await similarities(pool, text);
  return !!scores && Math.max(...scores) >= DUPLICATE_SIMILARITY;
};

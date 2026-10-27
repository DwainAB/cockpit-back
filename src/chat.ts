/** Réponses des agents dans les discussions, avec le modèle « conversations » de chaque agent (page Agents). */
import type Anthropic from '@anthropic-ai/sdk';
import { addAgentMemory, addPostIdeas, CHAT_HISTORY_LIMIT, type Agent, type Conversation, type Db, failAgentReply, pushAgentReply, specialtyLabel } from './core';
import { isKnownMemory, memoryContext, searchMemories } from './memorySearch';
import { claude, errorMessage, fallbackParams, responseText, usageOf } from './claude';
import { openrouterChat } from './openrouter';
import { store } from './store';

/** Ce que l'agent sait de la discussion éditoriale (dates et réseaux de la semaine). */
const editorialContext = (conv: Conversation) =>
  conv.editorial &&
  `Discussion éditoriale de la semaine : vous choisissez ensemble une idée de post pour chacune de ces dates : ${conv.editorial.slots
    .map((s) => new Date(s).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }))
    .join(', ')}, publiées sur ${conv.editorial.networks.join(', ')} (texte + image). Propose, écoute ses idées, ajuste ; quand il est d'accord, il cliquera sur « Valider les idées » et tu créeras les posts.`;

export const systemPrompt = async (db: Db, agent: Agent, conv: Conversation, query: string) => {
  const project = db.projects.find((p) => p.id === conv.projectId);
  const restaurant = conv.restaurantId ? db.restaurants.find((r) => r.id === conv.restaurantId) : null;
  // Seulement les souvenirs de ce projet (et les généraux) : pas de mélange entre projets.
  const context = await memoryContext(agent, query, conv.projectId);
  return [
    `Tu es ${agent.name}, agent ${specialtyLabel(agent.kind).toLowerCase()} du studio.`,
    `Tu échanges dans le cockpit avec le responsable du studio${project ? `, au sujet du projet « ${project.name} » : ${project.summary} Objectif : ${project.objective}` : ''}.${restaurant ? ` Restaurant concerné : ${restaurant.name}.` : ''}`,
    'Réponds en français, de façon brève et concrète. Depuis cette discussion, tu ne peux lancer aucune action : si on te demande d’agir, dis ce que tu ferais et ce qui doit être validé. N’invente pas d’avancement ni de chiffres que tu ne connais pas.',
    editorialContext(conv),
    context && `Consignes permanentes de l'agent (définies par le studio) :\n${context}`,
  ]
    .filter(Boolean)
    .join('\n\n');
};

/** Historique au format des API (mes messages → user, ceux de l'agent → assistant), commençant par un message de ma part. */
export const history = (conv: Conversation) => {
  const turns = conv.messages
    .filter((m) => m.from !== 'system')
    .slice(-CHAT_HISTORY_LIMIT)
    .map((m) => ({
      role: m.from === 'me' ? ('user' as const) : ('assistant' as const),
      content: m.attachment ? `${m.text}\n[Pièce jointe : ${m.attachment.name}]` : m.text,
    }));
  // Discussion ouverte par l'agent (discussion du lundi) : ses propositions restent dans le contexte.
  if (conv.editorial && turns[0]?.role === 'assistant') return [{ role: 'user' as const, content: 'Ouvre la discussion éditoriale de la semaine.' }, ...turns];
  const first = turns.findIndex((t) => t.role === 'user');
  return first === -1 ? [] : turns.slice(first);
};

export const generate = async (agent: Agent, system: string, messages: { role: 'user' | 'assistant'; content: string }[]) => {
  const { provider, model } = agent.models.chat;
  if (provider === 'openrouter') return openrouterChat({ model, system, messages, maxTokens: 4000 });
  const message = await claude().beta.messages.create({
    model,
    max_tokens: 16000,
    // Une discussion n'a pas besoin d'un raisonnement poussé : effort bas, réponse plus rapide et moins chère.
    output_config: { effort: 'low' },
    system,
    messages: messages as Anthropic.Beta.BetaMessageParam[],
    ...fallbackParams(model),
  });
  return { text: responseText(message).trim(), usage: usageOf(message, model) };
};

/** Lignes « - Titre — raison » → pistes (titre, raison). */
export const parseIdeaLines = (text: string, max: number) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*•]|^\d+[.)]/.test(l))
    .map((l) => l.replace(/^[-*•\d.)\s]+/, '').replace(/\*\*/g, '').trim())
    .filter((l) => l.length > 8 && !/^aucune?/i.test(l))
    .map((l) => {
      const [title, ...reason] = l.split(/\s+[—–-]\s+/);
      return { title: title.replace(/^[«"]\s*|\s*[»"]$/g, '').trim(), reason: reason.join(' — ').trim() || 'Proposée en discussion' };
    })
    .slice(0, max);

const IDEAS_PROMPT = `Tu relèves les idées de posts de réseaux sociaux proposées dans un message. Une idée est un sujet de post global, publié sur tous les réseaux à la fois : ses déclinaisons par réseau (Instagram, Facebook, LinkedIn…) font partie de la même idée. Ne crée jamais une idée par réseau.
Pour chaque idée réellement proposée (pas une simple question), écris une ligne : - Titre court du post — l'angle ou la raison, en une phrase.
Si le message ne propose aucune idée de post, réponds exactement : AUCUNE`;

/** Discussion éditoriale : les idées que l'agent vient de proposer rejoignent les pistes du projet (Retenir, Écarter, Valider). */
export const captureDiscussionIdeas = async (agent: Agent, conv: Conversation, message: string) => {
  if (!conv.editorial) return;
  const { text } = await generate(agent, IDEAS_PROMPT, [{ role: 'user', content: message }]);
  // Garde-fou : une ligne qui commence par un réseau est une déclinaison, pas une idée.
  const ideas = parseIdeaLines(text, 5).filter((i) => !/^(instagram|facebook|linkedin|tiktok)\b/i.test(i.title));
  if (!ideas.length) return;
  const added = store.mutate(({ db }) => addPostIdeas(db, conv.projectId, ideas, 'discussion', conv.id));
  if (added.length) console.log(`[éditorial] ${added.length} piste(s) ajoutée(s) depuis la discussion : ${added.map((i) => i.title).join(' | ')}`);
};

const MEMORY_PROMPT = `Tu tiens la mémoire longue durée d'un agent du studio. Dans le dernier échange, relève uniquement ce qui restera utile plus tard : décision prise, préférence d'un client ou du studio, règle ou fait durable. Ignore les salutations, les questions, l'avancement du moment et ce que la mémoire contient déjà.
Réponds par au plus 2 lignes commençant par « - », chacune une phrase autonome et précise (avec le nom du client ou du projet si utile). Si rien ne mérite d'être retenu, réponds exactement : AUCUN`;

/**
 * Mémorisation automatique : un appel court au modèle de conversation (le dernier échange et les souvenirs proches,
 * pas l'historique complet) en tire 0 à 2 souvenirs, sans doublon (ni mot pour mot, ni par le sens).
 */
const captureMemories = async (agent: Agent, conv: Conversation, question: string, answer: string) => {
  const project = store.snapshot.projects.find((p) => p.id === conv.projectId);
  const known = await searchMemories(agent, `${question} ${answer}`, undefined, conv.projectId);
  const content = `<memoire_actuelle>
${known.map((m) => `- ${m.text}`).join('\n') || '(vide)'}
</memoire_actuelle>

<echange projet="${project?.name ?? ''}">
Responsable du studio : ${question}
${agent.name} : ${answer}
</echange>`;
  const { text } = await generate(agent, MEMORY_PROMPT, [{ role: 'user', content }]);
  const candidates = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('-'))
    .map((l) => l.replace(/^-\s*/, '').trim())
    .filter((l) => l.length >= 12 && !/^aucun/i.test(l))
    .slice(0, 2);
  // Les doublons mot pour mot sont écartés par `addAgentMemory` ; ici, ceux qui redisent un souvenir avec d'autres mots.
  const facts: string[] = [];
  for (const fact of candidates) if (!(await isKnownMemory(agent, fact, conv.projectId))) facts.push(fact);
  if (!facts.length) return;
  store.mutate((ctx) => facts.forEach((fact) => addAgentMemory(ctx, agent.id, { text: fact, source: 'conversation', sourceId: conv.id, projectId: conv.projectId })));
  console.log(`[chat] ${agent.name} a mémorisé : ${facts.join(' | ')}`);
};

/** Fait répondre l'agent de la conversation ; le résultat (ou l'erreur) est ajouté à la discussion. */
export const replyToConversation = async (conversationId: string) => {
  const db = store.snapshot;
  const conv = db.conversations.find((c) => c.id === conversationId);
  const agent = conv && db.agents.find((a) => a.id === conv.agentId);
  if (!conv || !agent) return;
  const messages = history(conv);
  const lastQuestion = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  try {
    const { text, usage } = await generate(agent, await systemPrompt(db, agent, conv, lastQuestion), messages);
    if (!text) throw new Error('Réponse vide de l’agent.');
    store.mutate(({ db: d }) => pushAgentReply(d, conversationId, text));
    void captureDiscussionIdeas(agent, conv, text).catch((err) => console.error('[éditorial] pistes non relevées :', errorMessage(err)));
    console.log(`[chat] ${agent.name} a répondu (${usage.model}, ${usage.inputTokens}+${usage.outputTokens} tokens, ~${usage.costUsd} $)`);
    // Après la réponse, sans la retarder ; un échec ne touche pas la discussion.
    void captureMemories(agent, conv, lastQuestion, text).catch((err) => console.error(`[chat] mémorisation impossible pour ${agent.name} :`, errorMessage(err)));
  } catch (err) {
    console.error(`[chat] ${agent.name} n'a pas pu répondre`, err);
    store.mutate(({ db: d }) => failAgentReply(d, conversationId, errorMessage(err)));
  }
};

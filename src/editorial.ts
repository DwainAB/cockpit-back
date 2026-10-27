/**
 * Planning éditorial : chaque semaine (le lundi par défaut), l'agent du planning ouvre une discussion et propose
 * une idée de post par date de publication. Une fois les idées validées, il crée les posts (voir `social.ts`).
 */
import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as z from 'zod/v4';
import { addPostIdeas, type Conversation, dueBriefs, type EditorialIdea, editorialPlanOf, failAgentReply, ideaContext, networkLabel, openEditorialConversation, pushAgentReply } from './core';
import { captureDiscussionIdeas, generate, history, parseIdeaLines, systemPrompt } from './chat';
import { claude, errorMessage, fallbackParams, responseText } from './claude';
import { openrouterJson } from './openrouter';
import { store } from './store';

const SCHEDULER_MS = 60_000;
const fmtSlot = (iso: string) => new Date(iso).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/** Posts récents du projet, pour éviter les redites. */
const recentPosts = (projectId: string) =>
  store.snapshot.contents
    .filter((c) => c.projectId === projectId)
    .slice(0, 12)
    .map((c) => `- ${c.title} (${new Date(c.scheduledAt).toLocaleDateString('fr-FR')})`)
    .join('\n') || '(aucun)';

/** L'agent ouvre la discussion de la semaine avec ses propositions. */
export const openBrief = async (projectId: string) => {
  const conv = store.mutate(({ db }) => openEditorialConversation(db, projectId));
  const agent = store.snapshot.agents.find((a) => a.id === conv.agentId)!;
  const slots = conv.editorial!.slots;
  const request = `C'est le moment de préparer les posts de la semaine (${slots.length} à prévoir : ${slots.map(fmtSlot).join(' ; ')}), sur ${conv.editorial!.networks.map((n) => networkLabel[n]).join(', ')}.
Propose une idée par date : un titre, l'angle et pourquoi c'est pertinent maintenant (saison, actualité du projet, sujets peu abordés). Varie les sujets et évite les redites avec les posts récents :
${recentPosts(projectId)}
${ideaContext(store.snapshot.projects.find((p) => p.id === projectId)!)}
Termine en me demandant mon avis et si j'ai d'autres idées. Reste naturel, comme un collègue.`;
  try {
    const { text } = await generate(agent, await systemPrompt(store.snapshot, agent, conv, request), [{ role: 'user', content: request }]);
    store.mutate(({ db }) => pushAgentReply(db, conv.id, text));
    void captureDiscussionIdeas(agent, conv, text).catch((err) => console.error('[éditorial] pistes non relevées :', errorMessage(err)));
    console.log(`[éditorial] ${agent.name} a ouvert « ${conv.title} »`);
  } catch (err) {
    console.error('[éditorial] ouverture de la discussion impossible', err);
    store.mutate(({ db }) => failAgentReply(db, conv.id, errorMessage(err)));
  }
  return store.snapshot.conversations.find((c) => c.id === conv.id)!;
};

/**
 * Pistes de posts proposées par l'agent du planning (modèle « Conversations », gratuit) : sujets variés,
 * sans redite avec les posts récents ni avec les pistes déjà proposées ou écartées.
 */
export const suggestIdeas = async (projectId: string, count = 3) => {
  const project = store.snapshot.projects.find((p) => p.id === projectId);
  if (!project) throw new Error('Projet introuvable.');
  const agent = store.snapshot.agents.find((a) => a.id === editorialPlanOf(project).agentId);
  if (!agent) throw new Error('Agent du planning introuvable (page Agents).');
  const pending = (project.ideas ?? []).filter((i) => i.status === 'proposed').map((i) => `- ${i.title}`);
  const request = `Propose ${count} nouvelles pistes de posts pour le projet ${project.name} (${project.summary}).
Évite les redites avec les posts récents :
${recentPosts(projectId)}
${pending.length ? `Pistes déjà proposées, en attente :\n${pending.join('\n')}` : ''}
${ideaContext(project)}
Réponds uniquement par ${count} lignes au format : - Titre du post — pourquoi ce sujet maintenant (une phrase)`;
  const conv: Conversation = { id: 'pistes', agentId: agent.id, projectId, title: '', messages: [], suggestions: [] };
  const { text } = await generate(agent, await systemPrompt(store.snapshot, agent, conv, request), [{ role: 'user', content: request }]);
  const ideas = parseIdeaLines(text, count);
  if (!ideas.length) throw new Error('L’agent n’a proposé aucune piste exploitable. Réessayez.');
  return store.mutate(({ db }) => addPostIdeas(db, projectId, ideas));
};

const IdeasOutput = z.object({ ideas: z.array(z.object({ title: z.string(), objective: z.string() })) });

/**
 * Idées sur lesquelles on s'est mis d'accord, dans l'ordre des dates (modèle « Tâches » de l'agent : la sortie
 * doit être structurée et fiable). Je les relis et les ajuste avant de confirmer.
 */
export const extractIdeas = async (conv: Conversation): Promise<EditorialIdea[]> => {
  const agent = store.snapshot.agents.find((a) => a.id === conv.agentId);
  if (!agent || !conv.editorial) throw new Error('Discussion éditoriale introuvable.');
  const slots = conv.editorial.slots;
  const transcript = history(conv)
    .map((m) => `${m.role === 'user' ? 'Responsable du studio' : agent.name} : ${m.content}`)
    .join('\n\n');
  const system = `Tu résumes une discussion éditoriale entre ${agent.name} et le responsable du studio. Donne exactement ${slots.length} idée(s) de post, dans l'ordre de ces dates : ${slots.map(fmtSlot).join(' ; ')}.
Pour chaque date, reprends l'idée sur laquelle ils sont tombés d'accord (en priorité ce que le responsable a validé ou proposé) ; à défaut, la plus pertinente discutée. title : titre court du post. objective : l'angle et le message à faire passer, en une ou deux phrases. En français.`;
  const content: Anthropic.Beta.BetaContentBlockParam[] = [{ type: 'text', text: `<discussion>\n${transcript}\n</discussion>` }];
  const { provider, model } = agent.models.task;
  const out =
    provider === 'openrouter'
      ? (await openrouterJson({ model, system, content, schema: IdeasOutput, maxTokens: 8000, effort: 'low' })).output
      : IdeasOutput.parse(
          JSON.parse(
            responseText(
              await claude()
                .beta.messages.stream({
                  model,
                  max_tokens: 8000,
                  output_config: { effort: 'low', format: zodOutputFormat(IdeasOutput) },
                  system,
                  messages: [{ role: 'user', content }],
                  ...fallbackParams(model),
                })
                .finalMessage(),
            ),
          ),
        );
  return slots.map((scheduledAt, i) => ({ title: out.ideas[i]?.title ?? '', objective: out.ideas[i]?.objective ?? '', scheduledAt }));
};

/** Ouvre chaque semaine les discussions dont le jour et l'heure sont atteints. */
export const startEditorialScheduler = () => {
  const tick = () => dueBriefs(store.snapshot).forEach((p) => void openBrief(p.id));
  tick();
  setInterval(tick, SCHEDULER_MS).unref();
};

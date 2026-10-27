import { Router } from 'express';
import {
  addAgentMemory,
  addProjectNote,
  createAgent,
  confirmEditorialIdeas,
  createConversation,
  DomainError,
  updateEditorialPlan,
  setPostIdeaStatus,
  deletePostIdea,
  linkPostIdea,
  addPostIdeas,
  validatePostIdea,
  deleteAgentMemory,
  listAgentMemories,
  updateAgent,
  updateAgentMemory,
  markAllNotificationsRead,
  markNotificationRead,
  postUserMessage,
  toggleAutomation,
  toggleProjectSetting,
  updateSettings,
} from '../core';
import { replyToConversation } from '../chat';
import { extractIdeas, openBrief, suggestIdeas } from '../editorial';
import { createPost } from '../social';
import { searchMemories } from '../memorySearch';
import { handle, parse } from '../http';
import * as S from '../schemas';
import { store } from '../store';

/* Projets */
export const projects = Router();
projects.post(
  '/:id/notes',
  handle((req, res) => {
    const { text } = parse(S.note, req.body);
    res.status(201).json(store.mutate((ctx) => addProjectNote(ctx, req.params.id, text)));
  }),
);
projects.post(
  '/:id/settings/toggle',
  handle((req, res) => {
    const { key } = parse(S.projectSetting, req.body);
    res.json(store.mutate((ctx) => toggleProjectSetting(ctx, req.params.id, key)));
  }),
);

/* Planning éditorial d'un projet */
projects.patch(
  '/:id/editorial',
  handle((req, res) => {
    const patch = parse(S.editorialPatch, req.body);
    res.json(store.mutate((ctx) => updateEditorialPlan(ctx, req.params.id, patch)));
  }),
);
/** Ouvre tout de suite la discussion de la semaine (sans attendre le lundi). */
projects.post(
  '/:id/editorial/brief',
  handle(async (req, res) => {
    res.status(201).json(await openBrief(req.params.id));
  }),
);

/* Pistes de posts */
projects.post(
  '/:id/ideas/suggest',
  handle(async (req, res) => {
    res.status(201).json(await suggestIdeas(req.params.id));
  }),
);
/** Piste ajoutée à la main (ou reprise d'une discussion). */
projects.post(
  '/:id/ideas',
  handle((req, res) => {
    const idea = parse(S.newPostIdea, req.body);
    res.status(201).json(store.mutate(({ db }) => addPostIdeas(db, req.params.id, [idea], 'manual')));
  }),
);
projects.delete(
  '/:id/ideas/:ideaId',
  handle((req, res) => {
    res.json(store.mutate((ctx) => deletePostIdea(ctx, req.params.id, req.params.ideaId)));
  }),
);
projects.post(
  '/:id/ideas/:ideaId/link',
  handle((req, res) => {
    const { conversationId } = parse(S.ideaLink, req.body);
    res.json(store.mutate((ctx) => linkPostIdea(ctx, req.params.id, req.params.ideaId, conversationId)));
  }),
);
projects.post(
  '/:id/ideas/:ideaId/status',
  handle((req, res) => {
    const { status } = parse(S.ideaStatus, req.body);
    res.json(store.mutate((ctx) => setPostIdeaStatus(ctx, req.params.id, req.params.ideaId, status)));
  }),
);
projects.post(
  '/:id/ideas/:ideaId/validate',
  handle((req, res) => {
    const { scheduledAt } = parse(S.ideaValidation, req.body);
    const content = store.mutate((ctx) => validatePostIdea({ ...ctx, schedule: () => undefined }, req.params.id, req.params.ideaId, scheduledAt));
    void createPost(content.id);
    res.status(201).json(content);
  }),
);

/* Conversations — l'agent répond avec son modèle « conversations », en arrière-plan (SSE à l'arrivée de la réponse) */
export const conversations = Router();
conversations.post(
  '/',
  handle((req, res) => {
    const input = parse(S.newConversation, req.body);
    res.status(201).json(store.mutate((ctx) => createConversation(ctx, input)));
  }),
);
conversations.post(
  '/:id/messages',
  handle((req, res) => {
    const { text, attachment } = parse(S.chatMessage, req.body);
    const message = store.mutate(({ db }) => postUserMessage(db, req.params.id, text, attachment));
    void replyToConversation(req.params.id);
    res.status(201).json(message);
  }),
);

/** Discussion éditoriale : idées retenues, à relire avant confirmation. */
conversations.post(
  '/:id/editorial/ideas',
  handle(async (req, res) => {
    const conv = store.snapshot.conversations.find((c) => c.id === req.params.id);
    if (!conv?.editorial) throw new DomainError('Discussion éditoriale introuvable.', 404);
    res.json(await extractIdeas(conv));
  }),
);
/** Idées confirmées : un post par idée, créé par l'agent. */
conversations.post(
  '/:id/editorial/confirm',
  handle((req, res) => {
    const { ideas } = parse(S.editorialIdeas, req.body);
    const created = store.mutate((ctx) => confirmEditorialIdeas({ ...ctx, schedule: () => undefined }, req.params.id, ideas));
    created.forEach((c) => void createPost(c.id));
    res.status(201).json(created);
  }),
);

/* Notifications */
export const notifications = Router();
notifications.post(
  '/read-all',
  handle((_req, res) => {
    res.json({ updated: store.mutate((ctx) => markAllNotificationsRead(ctx)) });
  }),
);
notifications.post(
  '/:id/read',
  handle((req, res) => {
    res.json(store.mutate((ctx) => markNotificationRead(ctx, req.params.id)));
  }),
);

/* Paramètres */
export const settings = Router();
settings.get(
  '/',
  handle((_req, res) => {
    res.json(store.snapshot.settings);
  }),
);
settings.patch(
  '/',
  handle((req, res) => {
    const patch = parse(S.settingsPatch, req.body);
    res.json(store.mutate((ctx) => updateSettings(ctx, patch)));
  }),
);
settings.post(
  '/automations/:id/toggle',
  handle((req, res) => {
    res.json(store.mutate((ctx) => toggleAutomation(ctx, req.params.id)));
  }),
);

/* Agents (configuration) */
export const agents = Router();
agents.post(
  '/',
  handle((req, res) => {
    const input = parse(S.newAgent, req.body);
    res.status(201).json(store.mutate((ctx) => createAgent(ctx, input)));
  }),
);
agents.patch(
  '/:id',
  handle((req, res) => {
    const patch = parse(S.agentPatch, req.body);
    res.json(store.mutate((ctx) => updateAgent(ctx, req.params.id, patch)));
  }),
);

/* Mémoire des agents — recherche par le sens et par mots communs avec ?q= */
agents.get(
  '/:id/memories',
  handle(async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const all = listAgentMemories({ db: store.snapshot }, req.params.id);
    res.json(query ? await searchMemories(store.snapshot.agents.find((a) => a.id === req.params.id)!, query) : all);
  }),
);
agents.post(
  '/:id/memories',
  handle((req, res) => {
    const input = parse(S.agentMemory, req.body);
    res.status(201).json(store.mutate((ctx) => addAgentMemory(ctx, req.params.id, input)));
  }),
);
agents.patch(
  '/:id/memories/:memoryId',
  handle((req, res) => {
    const patch = parse(S.agentMemoryPatch, req.body);
    res.json(store.mutate((ctx) => updateAgentMemory(ctx, req.params.id, req.params.memoryId, patch)));
  }),
);
agents.delete(
  '/:id/memories/:memoryId',
  handle((req, res) => {
    res.json(store.mutate((ctx) => deleteAgentMemory(ctx, req.params.id, req.params.memoryId)));
  }),
);

import { Router } from 'express';
import {
  addProjectNote,
  createAgent,
  createConversation,
  updateAgent,
  markAllNotificationsRead,
  markNotificationRead,
  sendMessage,
  toggleAutomation,
  toggleProjectSetting,
  updateSettings,
} from '../core';
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

/* Conversations — réponses simulées, aucune IA n'est appelée */
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
    res.status(201).json(store.mutate((ctx) => sendMessage(ctx, req.params.id, text, attachment)));
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

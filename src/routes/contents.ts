import { Router } from 'express';
import { addIdea, contentAction, deleteContent, updateContent } from '../core';
import { handle, parse } from '../http';
import * as S from '../schemas';
import { createPost, publishPost } from '../social';
import { store } from '../store';

export const contents = Router();

contents.post(
  '/',
  handle((req, res) => {
    const input = parse(S.newIdea, req.body);
    res.status(201).json(store.mutate((ctx) => addIdea(ctx, input)));
  }),
);

/** Les effets simulés du mode démo sont désactivés : création et publication réelles, en arrière-plan. */
contents.post(
  '/:id/actions',
  handle((req, res) => {
    const { action, comment } = parse(S.contentActionBody, req.body);
    const content = store.mutate((ctx) => contentAction({ ...ctx, schedule: () => undefined }, req.params.id, action, comment));
    if (action === 'submit_topic' || action === 'validate_topic') void createPost(content.id);
    if (action === 'request_changes') void createPost(content.id, comment ?? null);
    if (action === 'publish_now' || action === 'retry') void publishPost(content.id);
    res.json(content);
  }),
);

contents.delete(
  '/:id',
  handle((req, res) => {
    res.json(store.mutate((ctx) => deleteContent(ctx, req.params.id)));
  }),
);

contents.patch(
  '/:id',
  handle((req, res) => {
    const patch = parse(S.contentPatch, req.body);
    res.json(store.mutate((ctx) => updateContent(ctx, req.params.id, patch)));
  }),
);

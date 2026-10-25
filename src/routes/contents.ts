import { Router } from 'express';
import { addIdea, contentAction } from '../core';
import { handle, parse } from '../http';
import * as S from '../schemas';
import { store } from '../store';

export const contents = Router();

contents.post(
  '/',
  handle((req, res) => {
    const input = parse(S.newIdea, req.body);
    res.status(201).json(store.mutate((ctx) => addIdea(ctx, input)));
  }),
);

contents.post(
  '/:id/actions',
  handle((req, res) => {
    const { action, comment } = parse(S.contentActionBody, req.body);
    res.json(store.mutate((ctx) => contentAction(ctx, req.params.id, action, comment)));
  }),
);

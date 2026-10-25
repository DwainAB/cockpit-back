import { Router } from 'express';
import { addTask, addTaskComment, setTaskStatus, validateTask } from '../core';
import { handle, parse } from '../http';
import * as S from '../schemas';
import { store } from '../store';

export const tasks = Router();

tasks.post(
  '/',
  handle((req, res) => {
    const input = parse(S.newTask, req.body);
    res.status(201).json(store.mutate((ctx) => addTask(ctx, input)));
  }),
);

tasks.patch(
  '/:id',
  handle((req, res) => {
    const { status } = parse(S.taskStatus, req.body);
    res.json(store.mutate((ctx) => setTaskStatus(ctx, req.params.id, status)));
  }),
);

tasks.post(
  '/:id/validate',
  handle((req, res) => {
    res.json(store.mutate((ctx) => validateTask(ctx, req.params.id)));
  }),
);

tasks.post(
  '/:id/comments',
  handle((req, res) => {
    const { text } = parse(S.note, req.body);
    res.status(201).json(store.mutate((ctx) => addTaskComment(ctx, req.params.id, text)));
  }),
);

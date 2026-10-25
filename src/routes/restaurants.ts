import { Router } from 'express';
import { addRestaurantNote, setStripeStatus, workflowAction } from '../core';
import { handle, parse } from '../http';
import * as S from '../schemas';
import { store } from '../store';

export const restaurants = Router();

restaurants.post(
  '/:id/notes',
  handle((req, res) => {
    const { text } = parse(S.note, req.body);
    res.json(store.mutate((ctx) => addRestaurantNote(ctx, req.params.id, text)));
  }),
);

restaurants.patch(
  '/:id/stripe',
  handle((req, res) => {
    const { status } = parse(S.stripeStatus, req.body);
    res.json(store.mutate((ctx) => setStripeStatus(ctx, req.params.id, status)));
  }),
);

restaurants.post(
  '/:id/workflow/:stepKey/actions',
  handle((req, res) => {
    const stepKey = parse(S.workflowStepKey, req.params.stepKey);
    const { action, comment } = parse(S.workflowActionBody, req.body);
    res.json(store.mutate((ctx) => workflowAction(ctx, req.params.id, stepKey, action, comment)));
  }),
);

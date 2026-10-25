import { Router } from 'express';
import { handle, parse } from '../http';
import * as S from '../schemas';
import { yumco } from '../yumco';

/** Liens de questionnaire envoyés aux restaurateurs : un lien neuf, à usage unique, par envoi et par offre. */
export const invitations = Router();

invitations.get(
  '/',
  handle(async (_req, res) => {
    res.json(await yumco.listInvitations());
  }),
);

invitations.post(
  '/',
  handle(async (req, res) => {
    const { plan, email } = parse(S.invitationBody, req.body);
    res.status(201).json(await yumco.createInvitation(plan, email));
  }),
);

invitations.post(
  '/:id/cancel',
  handle(async (req, res) => {
    await yumco.cancelInvitation(Number(req.params.id));
    res.status(204).end();
  }),
);

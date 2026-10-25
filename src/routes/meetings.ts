import { Router } from 'express';
import { addMeeting, addMeetingItem, addTranscriptNote, createTasksFromMeeting, sendMeetingMessage, setMeetingStatus } from '../core';
import { handle, parse } from '../http';
import * as S from '../schemas';
import { store } from '../store';

export const meetings = Router();

meetings.post(
  '/',
  handle((req, res) => {
    const input = parse(S.newMeeting, req.body);
    res.status(201).json(store.mutate((ctx) => addMeeting(ctx, input)));
  }),
);

meetings.patch(
  '/:id',
  handle((req, res) => {
    const { status } = parse(S.meetingStatus, req.body);
    res.json(store.mutate((ctx) => setMeetingStatus(ctx, req.params.id, status)));
  }),
);

meetings.post(
  '/:id/items',
  handle((req, res) => {
    const { kind, text } = parse(S.meetingItem, req.body);
    res.status(201).json(store.mutate((ctx) => addMeetingItem(ctx, req.params.id, kind, text)));
  }),
);

meetings.post(
  '/:id/notes',
  handle((req, res) => {
    const { text } = parse(S.note, req.body);
    res.status(201).json(store.mutate((ctx) => addTranscriptNote(ctx, req.params.id, text)));
  }),
);

/** Message dans une réunion : les agents participants répondent à tour de rôle (simulation). */
meetings.post(
  '/:id/messages',
  handle((req, res) => {
    const { text } = parse(S.note, req.body);
    res.status(201).json(store.mutate((ctx) => sendMeetingMessage(ctx, req.params.id, text)));
  }),
);

meetings.post(
  '/:id/create-tasks',
  handle((req, res) => {
    res.json({ created: store.mutate((ctx) => createTasksFromMeeting(ctx, req.params.id)) });
  }),
);

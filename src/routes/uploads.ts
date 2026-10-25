import { Router } from 'express';
import { handle } from '../http';
import { receiveFile, saveUpload } from '../uploads';

/** Envoi d'image depuis le questionnaire (logo, photos). */
export const uploads = Router();
uploads.post(
  '/',
  receiveFile,
  handle((req, res) => {
    res.status(201).json(saveUpload(req.file));
  }),
);

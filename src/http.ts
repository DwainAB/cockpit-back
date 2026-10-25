import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { DomainError } from './core';
import { MulterError } from 'multer';
import { ZodError, type ZodTypeAny, type z } from 'zod';

export const parse = <S extends ZodTypeAny>(schema: S, value: unknown): z.infer<S> => schema.parse(value);

/** Enveloppe un handler pour transmettre toute exception au gestionnaire d'erreurs. */
export const handle =
  (fn: (req: Request, res: Response) => unknown): RequestHandler =>
  (req, res, next) => {
    try {
      const out = fn(req, res);
      if (out instanceof Promise) out.catch(next);
    } catch (err) {
      next(err);
    }
  };

export const errorHandler = (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Données invalides', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    return;
  }
  if (err instanceof DomainError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof MulterError) {
    res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image trop lourde.' : `Envoi refusé : ${err.message}` });
    return;
  }
  if (err instanceof SyntaxError) {
    res.status(400).json({ error: 'JSON invalide' });
    return;
  }
  console.error('[api] erreur inattendue', err);
  res.status(500).json({ error: 'Erreur interne du serveur' });
};

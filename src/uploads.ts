import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { RequestHandler } from 'express';
import multer from 'multer';
import type { UploadedFile } from './core';
import { DomainError } from './core';
import { config } from './config';

fs.mkdirSync(config.uploadsDir, { recursive: true });

/** Fichier reçu en mémoire puis vérifié avant écriture. */
export const receiveFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
}).single('file');

/** Type réel d'après les premiers octets : on ne fait pas confiance à l'extension ni au type annoncé. */
const sniff = (buf: Buffer): 'png' | 'jpg' | 'webp' | null => {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
};

/** Enregistre une image sous un nom aléatoire et renvoie sa description publique. */
export const saveImage = (buffer: Buffer, originalName: string): UploadedFile => {
  const ext = sniff(buffer);
  if (!ext) throw new DomainError('Format non pris en charge : envoyez une image PNG, JPEG ou WebP.', 415);
  const id = crypto.randomUUID();
  fs.writeFileSync(path.join(config.uploadsDir, `${id}.${ext}`), buffer);
  const name = path.basename(originalName).replace(/[^\p{L}\p{N}._ -]/gu, '').slice(0, 200) || `image.${ext}`;
  return { id, url: `/api/uploads/${id}.${ext}`, name };
};

/** Image reçue du formulaire du cockpit. */
export const saveUpload = (file: Express.Multer.File | undefined): UploadedFile => {
  if (!file) throw new DomainError('Aucun fichier reçu (champ « file »).');
  return saveImage(file.buffer, file.originalname);
};

/** Copie locale d'une image envoyée depuis le questionnaire public (Cloudinary), pour les agents design et développeur. */
export const downloadImage = async (file: UploadedFile): Promise<UploadedFile> => {
  if (!file.url.startsWith('https://res.cloudinary.com/')) throw new DomainError(`Image refusée (origine inconnue) : ${file.url}`, 400);
  const res = await fetch(file.url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new DomainError(`Image introuvable (${res.status}) : ${file.url}`, 502);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > config.maxUploadMb * 1024 * 1024) throw new DomainError(`Image trop lourde : ${file.name}`, 413);
  return saveImage(buffer, file.name);
};

const contentTypes = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;

/** Sert une image envoyée, uniquement si le nom correspond au format généré. */
export const serveUpload: RequestHandler = (req, res) => {
  const match = /^([0-9a-f-]{36})\.(png|jpg|webp)$/.exec(req.params.file ?? '');
  const file = match && path.join(config.uploadsDir, match[0]);
  if (!match || !file || !fs.existsSync(file)) {
    res.status(404).json({ error: 'Fichier introuvable' });
    return;
  }
  res.set({ 'Content-Type': contentTypes[match[2] as keyof typeof contentTypes], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable' });
  res.sendFile(file);
};

/** Chemin local d'une image envoyée, à partir de son URL publique (`/api/uploads/<id>.<ext>`). */
export const uploadPath = (url: string) => {
  const match = /^\/api\/uploads\/([0-9a-f-]{36}\.(png|jpg|webp))$/.exec(url);
  return match ? { file: path.join(config.uploadsDir, match[1]), mediaType: contentTypes[match[2] as keyof typeof contentTypes] } : null;
};

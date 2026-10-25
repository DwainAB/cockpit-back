/**
 * Serveur d'aperçu des sites développés.
 * Il tourne sur une origine distincte du cockpit : le JavaScript généré par l'IA s'y exécute
 * sans pouvoir accéder au cockpit ni à son API.
 */
import fs from 'node:fs';
import express from 'express';
import { config } from './config';
import { sitePath } from './developer';

export const startPreviewServer = () => {
  const app = express();
  app.disable('x-powered-by');
  const parents = [...config.corsOrigins, 'http://localhost:5174', 'http://127.0.0.1:5174'].join(' ');

  app.use('/s/:buildId', (req, res, next) => {
    const dir = sitePath(req.params.buildId);
    if (!dir || !fs.existsSync(dir)) {
      res.status(404).type('text/plain').send('Aperçu introuvable');
      return;
    }
    res.set({
      'Content-Security-Policy': `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'self' ${parents}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    express.static(dir, { extensions: ['html'], index: 'index.html' })(req, res, next);
  });
  app.use((_req, res) => {
    res.status(404).type('text/plain').send('Aperçu introuvable');
  });

  app.listen(config.previewPort, () => console.log(`[preview] aperçus des sites sur ${config.previewOrigin}`));
};

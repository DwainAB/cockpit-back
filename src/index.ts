import type { Server } from 'node:http';
import { createApp } from './app';
import { config } from './config';
import { closeDbs } from './db';
import { resumeQueue } from './designer';
import { resumeDeliveries } from './delivery';
import { resumeBuilds } from './developer';
import { startImporter } from './importer';
import { startPreviewServer } from './preview';
import { store } from './store';

let server: Server | null = null;

const start = async () => {
  // Les données doivent être chargées avant de répondre aux requêtes et de reprendre les files d'attente.
  await store.init();
  await store.refreshRestaurants();
  store.startRestaurantSync();
  startPreviewServer();
  server = createApp().listen(config.port, () => {
    console.log(`[api] Cockpit API sur http://localhost:${config.port}/api`);
    console.log(`[api] base du cockpit : PostgreSQL · restaurants : ${config.yumcoDatabaseUrl ? 'base Yumco' : 'aucune base Yumco configurée'}`);
    resumeQueue();
    resumeBuilds();
    resumeDeliveries();
    startImporter();
    console.log(
      `[api] génération du design : ${config.designGenerator === 'claude' ? `Claude (${config.designModel}, effort ${config.designEffort})` : 'simulée (aucune clé API)'}`,
    );
  });
};

start().catch((err) => {
  console.error('[api] démarrage impossible :', (err as Error).message);
  process.exit(1);
});

const shutdown = async () => {
  // Les connexions SSE restent ouvertes et la base peut ne pas répondre : sortie forcée au bout de 5 s.
  setTimeout(() => process.exit(0), 5000).unref();
  await store.flush();
  server?.close();
  await closeDbs().catch(() => undefined);
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

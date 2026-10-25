import { createApp } from './app';
import { config } from './config';
import { resumeQueue } from './designer';
import { resumeDeliveries } from './delivery';
import { resumeBuilds } from './developer';
import { startImporter } from './importer';
import { startPreviewServer } from './preview';
import { store } from './store';

startPreviewServer();

const server = createApp().listen(config.port, () => {
  console.log(`[api] Cockpit API sur http://localhost:${config.port}/api`);
  console.log(`[api] persistance ${config.persist ? `activée → ${config.dataFile}` : 'désactivée'}`);
  resumeQueue();
  resumeBuilds();
  resumeDeliveries();
  startImporter();
  console.log(
    `[api] génération du design : ${config.designGenerator === 'claude' ? `Claude (${config.designModel}, effort ${config.designEffort})` : 'simulée (aucune clé API)'}`,
  );
});

const shutdown = () => {
  store.flush();
  server.close(() => process.exit(0));
  // Les connexions SSE restent ouvertes : on force la sortie après un court délai.
  setTimeout(() => process.exit(0), 500).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

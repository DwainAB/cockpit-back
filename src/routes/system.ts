import { Router } from 'express';
import type { Db } from '../core';
import { handle } from '../http';
import { store } from '../store';

export const system = Router();

system.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: store.currentVersion, uptime: Math.round(process.uptime()) });
});

/** Instantané complet utilisé par le frontend au démarrage et après chaque changement. */
system.get(
  '/bootstrap',
  handle((_req, res) => {
    res.json({ version: store.currentVersion, db: store.snapshot });
  }),
);

/** Flux SSE : un événement `change` à chaque mutation (y compris les effets différés). */
system.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(`event: ready\ndata: ${JSON.stringify({ version: store.currentVersion })}\n\n`);
  const onChange = (version: number) => res.write(`event: change\ndata: ${JSON.stringify({ version })}\n\n`);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  store.on('change', onChange);
  req.on('close', () => {
    clearInterval(ping);
    store.off('change', onChange);
  });
});

/** Lecture générique des collections : GET /api/:collection et /api/:collection/:id */
const collections = ['restaurants', 'projects', 'tasks', 'contents', 'meetings', 'agents', 'conversations', 'notifications', 'activities'] as const;
type CollectionName = (typeof collections)[number];

for (const name of collections) {
  const list = () => store.snapshot[name as CollectionName] as Db[CollectionName];
  system.get(
    `/${name}`,
    handle((req, res) => {
      // Filtre simple sur les champs de premier niveau : ?status=active&agentId=agent-dev
      const filters = Object.entries(req.query).filter((e): e is [string, string] => typeof e[1] === 'string');
      const items = (list() as unknown as Record<string, unknown>[]).filter((item) => filters.every(([k, v]) => String(item[k]) === v));
      res.json(items);
    }),
  );
  system.get(
    `/${name}/:id`,
    handle((req, res) => {
      const item = (list() as unknown as { id: string }[]).find((x) => x.id === req.params.id);
      if (!item) {
        res.status(404).json({ error: `Introuvable : ${req.params.id}` });
        return;
      }
      res.json(item);
    }),
  );
}

system.get('/finance', (_req, res) => {
  res.json(store.snapshot.finance);
});

/** Intégrations externes : volontairement non connectées dans cette version. */
system.post('/integrations/:provider/sync', (req, res) => {
  res.status(503).json({ error: `Intégration « ${req.params.provider} » non connectée dans cette version.` });
});

/** Les données sont en base : la réinitialisation de la démo n'existe qu'en mode mock (navigateur). */
system.post('/demo/reset', (_req, res) => {
  res.status(410).json({ error: 'Réinitialisation indisponible : les données du cockpit sont en base.' });
});

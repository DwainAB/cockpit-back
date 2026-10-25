import cors from 'cors';
import express from 'express';
import { config } from './config';
import { errorHandler } from './http';
import { serveUpload } from './uploads';
import { contents } from './routes/contents';
import { meetings } from './routes/meetings';
import { agents, conversations, notifications, projects, settings } from './routes/misc';
import { drafts } from './routes/drafts';
import { invitations } from './routes/invitations';
import { uploads } from './routes/uploads';
import { restaurants } from './routes/restaurants';
import { system } from './routes/system';
import { tasks } from './routes/tasks';

export const createApp = () => {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: '200kb' }));
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (req.path !== '/api/events') console.log(`[api] ${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - start} ms)`);
    });
    next();
  });

  const api = express.Router();
  // Les routes spécifiques sont montées avant la lecture générique des collections.
  api.use('/restaurants', restaurants);
  api.use('/tasks', tasks);
  api.use('/contents', contents);
  api.use('/meetings', meetings);
  api.use('/projects', projects);
  api.use('/conversations', conversations);
  api.use('/notifications', notifications);
  api.use('/settings', settings);
  api.use('/agents', agents);
  api.use('/drafts', drafts);
  api.use('/invitations', invitations);
  api.use('/uploads', uploads);
  api.get('/uploads/:file', serveUpload);
  api.use('/', system);
  api.use((_req, res) => {
    res.status(404).json({ error: 'Route inconnue' });
  });

  app.use('/api', api);
  app.use(errorHandler);
  return app;
};

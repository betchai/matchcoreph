import { fastify } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDb, type Db } from './db/client.js';
import { handleError, resolveContext } from './http/helpers.js';
import { authRoutes } from './http/auth.routes.js';
import { platformRoutes } from './http/platform.routes.js';
import { orgRoutes } from './http/org.routes.js';
import { scoringRoutes } from './http/scoring.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '../../../');
export const WEB_DIST = path.join(REPO_ROOT, 'apps/web/dist');
export const LANDING_PATH = path.join(REPO_ROOT, 'matchcoreph_landing_page.html');

export function buildApp(db: Db, opts: { webDist?: string } = {}): import('fastify').FastifyInstance {
  const webDist = opts.webDist ?? WEB_DIST;
  const hasWeb = existsSync(path.join(webDist, 'index.html'));

  const app = fastify({ logger: process.env.NODE_ENV !== 'test' });

  app.register(cookie);
  app.register(cors, { origin: true, credentials: true });
  app.register(rateLimit, { max: 600, timeWindow: '1 minute' });

  if (hasWeb) {
    app.register(fastifyStatic, { root: webDist, wildcard: false, index: ['index.html'] });
  }

  app.addHook('onRequest', async (req) => {
    req.db = db;
    req.ctx = resolveContext(req);
  });

  app.setErrorHandler((err, _req, reply) => {
    handleError(err, reply);
  });

  authRoutes(app);
  platformRoutes(app);
  orgRoutes(app);
  scoringRoutes(app);

  app.get('/landing', (_req, reply) => {
    if (existsSync(LANDING_PATH)) {
      return reply
        .type('text/html; charset=utf-8')
        .header('Cache-Control', 'no-cache')
        .send(readFileSync(LANDING_PATH));
    }
    return reply.status(404).send({ error: 'NOT_FOUND', message: 'Landing page not found.' });
  });

  app.setNotFoundHandler((req, reply) => {
    const indexHtml = path.join(webDist, 'index.html');
    if (req.method === 'GET' && !req.url.startsWith('/api/') && existsSync(indexHtml)) {
      return reply
        .type('text/html; charset=utf-8')
        .header('Cache-Control', 'no-cache')
        .send(readFileSync(indexHtml));
    }
    return reply.status(404).send({ error: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found.` });
  });

  return app;
}

function main(): void {
  const dir = process.env.PSA_DATA_DIR ?? path.join(REPO_ROOT, 'data');
  const db = openDb(dir);
  const app = buildApp(db);
  const port = Number(process.env.PORT ?? 4000);
  app.listen({ port, host: '0.0.0.0' }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
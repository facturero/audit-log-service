import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { AuditLogService } from '../../application/audit-logs.js';
import { requireOrganization, requirePermission } from './middlewares.js';
import { detailController, listController, summaryController } from './controllers.js';

export function createApp(opts: { service: AuditLogService; corsOrigin: string }): Hono {
  const app = new Hono();

  if (opts.corsOrigin) {
    const origins = opts.corsOrigin
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    app.use(
      '*',
      cors({
        origin: origins,
        allowMethods: ['GET', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
        credentials: true,
      }),
    );
  }

  app.get('/health', (c) => c.json({ status: 'ok' }));

  // Solo lectura; el permiso se exige a nivel de prefijo (toda la bitácora).
  app.use('/audit-logs/*', requireOrganization(), requirePermission('audit:read'));

  app.get('/audit-logs', listController(opts.service));
  // /summary debe registrarse antes de /:id para no cazarlo como id.
  app.get('/audit-logs/summary', summaryController(opts.service));
  app.get('/audit-logs/:id', detailController(opts.service));

  app.onError((err, c) => {
    console.error('[audit-log-service] error:', err);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Error interno del servicio' } }, 500);
  });

  return app;
}
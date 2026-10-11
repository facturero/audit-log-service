import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { httpInstrumentationMiddleware } from '@hono/otel';
import { trace } from '@opentelemetry/api';
import { AuditLogService } from '../../application/audit-logs.js';
import { requireOrganization, requirePermission } from './middlewares.js';
import { detailController, listController, summaryController } from './controllers.js';

export function createApp(opts: { service: AuditLogService; corsOrigin: string }): Hono {
  const app = new Hono();

  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    app.use('*', httpInstrumentationMiddleware({
      serviceName: process.env.OTEL_SERVICE_NAME ?? 'audit-log-service',
      captureRequestHeaders: ['x-request-id'],
      // Sin `spanNameFactory` a propósito: el nombre por defecto usa la plantilla de ruta (/x/:id). Con el path real
      // cada recurso sería un nombre de span distinto y SigNoz no podría agrupar nada.
    }));
  }
  // Quién hizo la petición, en el span de servidor. Mismos nombres que usa el frontend (app.org_id / app.user_id): con ellos
  // se filtra una organización o una persona de punta a punta, del navegador al servicio. Los pone el gateway (JWT), no el cliente.
  app.use('*', async (c, next) => {
    const span = trace.getActiveSpan();
    if (span) {
      const org = c.req.header('x-organization-id');
      const user = c.req.header('x-user-id');
      if (org) span.setAttribute('app.org_id', org);
      if (user) span.setAttribute('app.user_id', user);
    }
    await next();
  });

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
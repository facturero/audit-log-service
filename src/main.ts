import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { AuditLogService } from './application/audit-logs.js';
import { SequelizeAuditLogRepository } from './infrastructure/persistence/audit-log-repository.js';
import { AuditConsumer } from './infrastructure/messaging/consumer.js';
import { createApp } from './interface/http/app.js';

async function main(): Promise<void> {
  const config = loadConfig();

  const service = new AuditLogService(new SequelizeAuditLogRepository());

  const httpApp = createApp({
    service,
    corsOrigin: config.CORS_ORIGIN,
  });

  serve({ fetch: httpApp.fetch, port: config.PORT });

  const consumer = new AuditConsumer();
  await consumer.start(config.RABBITMQ_URL, service);

  // Retención: una pasada al arrancar y luego una al día. Desactivada por
  // defecto (AUDIT_RETENTION_DAYS=0 → conservar para siempre).
  let purgeTimer: NodeJS.Timeout | null = null;
  if (config.AUDIT_RETENTION_DAYS > 0) {
    const runPurge = async () => {
      try {
        const deleted = await service.purge(config.AUDIT_RETENTION_DAYS);
        if (deleted > 0) {
          console.log(`[audit-log-service] purga: ${deleted} filas > ${config.AUDIT_RETENTION_DAYS} días`);
        }
      } catch (err) {
        console.error('[audit-log-service] la purga falló, se reintenta mañana:', err);
      }
    };
    await runPurge();
    purgeTimer = setInterval(runPurge, 24 * 60 * 60 * 1000);
    purgeTimer.unref();
  }

  console.log('[audit-log-service] started');

  const shutdown = async () => {
    console.log('[audit-log-service] shutting down...');
    if (purgeTimer) clearInterval(purgeTimer);
    await consumer.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[audit-log-service] fatal:', err);
  process.exit(1);
});
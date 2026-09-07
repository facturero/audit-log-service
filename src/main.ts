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

  console.log('[audit-log-service] started');

  const shutdown = async () => {
    console.log('[audit-log-service] shutting down...');
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
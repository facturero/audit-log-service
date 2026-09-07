import { ConsumeMessage } from 'amqplib';
import { EventHandler, InboxConsumer } from '@facturero/outbox-relay';
import { AUDITED_EVENTS } from '../../config.js';
import { AuditLogService } from '../../application/audit-logs.js';
import { extractAuditEntry } from '../../domain/audit-entry.js';
import { sequelize } from '../persistence/models.js';

const EXCHANGE = 'crm.events';
const QUEUE = 'audit-log-service.events';

async function handleAudit(
  service: AuditLogService,
  eventType: string,
  payload: unknown,
  msg: ConsumeMessage,
): Promise<void> {
  // La idempotencia del relay depende de eventId (headers): sin él no se puede
  // garantizar "un evento = una fila" y el evento no es auditable.
  const eventId = msg.properties.headers?.eventId;
  if (typeof eventId !== 'string' || !eventId) {
    console.warn(`[audit] ${eventType}: sin eventId en headers, se descarta`);
    return;
  }

  const rec =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : {};

  const draft = extractAuditEntry({
    routingKey: msg.fields.routingKey,
    payload: rec,
    eventId,
    amqpTimestamp: typeof msg.properties.timestamp === 'number' ? msg.properties.timestamp : undefined,
    correlationId:
      typeof msg.properties.correlationId === 'string' ? msg.properties.correlationId : undefined,
  });

  if (!draft) {
    console.warn(`[audit] ${eventType}: evento no auditable (organizationId inválido), se descarta`);
    return;
  }

  await service.record(draft);
  console.log(`[audit] persisted ${draft.event} (${draft.id})`);
}

export function buildHandlers(service: AuditLogService): EventHandler[] {
  return AUDITED_EVENTS.map((eventType) => ({
    eventType,
    handle: (payload: unknown, msg: ConsumeMessage) => handleAudit(service, eventType, payload, msg),
  }));
}

/** Consumidor catch-all de crm.events vía la librería outbox-relay. Nada de
 *  lógica RabbitMQ propia: reconexión, reintentos inmediatos, cola de retry
 *  (TTL+DLX) y estado `failed` los gestiona InboxConsumer. */
export class AuditConsumer {
  private consumer: InboxConsumer | null = null;

  async start(rabbitmqUrl: string, service: AuditLogService): Promise<void> {
    await sequelize.authenticate();
    await sequelize.sync();

    this.consumer = new InboxConsumer({
      sequelize,
      rabbitmqUrl,
      exchange: EXCHANGE,
      queue: QUEUE,
      // Catch-all: registra TODO lo que pase por el exchange; los eventos sin
      // handler del catálogo se descartan con warn (ver AUDITED_EVENTS).
      bindings: ['#'],
      handlers: buildHandlers(service),
    });
    await this.consumer.start();

    console.log('[audit-log-service] listening for events...');
  }

  async stop(): Promise<void> {
    await this.consumer?.stop();
  }
}
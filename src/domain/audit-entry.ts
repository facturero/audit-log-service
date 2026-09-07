import { createHash } from 'node:crypto';

/** Fila ya normalizada que el consumidor persiste. */
export interface AuditDraft {
  id: string;
  organizationId: string | null;
  userId: string | null;
  actorEmail: string | null;
  event: string;
  resource: string;
  action: string;
  targetId: string | null;
  ip: string | null;
  requestId: string | null;
  payload: Record<string, unknown> | null;
  occurredAt: Date;
}

/** Namespace del proyecto para los uuids v5. Fijo DE PROPÓSITO: cambiarlo
 *  invalidaría todos los ids ya persistidos (la bitácora es inmutable). */
const AUDIT_NAMESPACE = 'f0c9d6a4-2d7b-4b3a-9c1e-5a8f4a2e6b01';

/**
 * UUID v5 determinista: mismo `name` → mismo uuid. La librería uuid no entra
 * solo para esto; SHA-1 + versión/variante bastan y no suman dependencias.
 */
export function deterministicUuidV5(name: string): string {
  const sha = createHash('sha1');
  sha.update(Buffer.from(AUDIT_NAMESPACE.replaceAll('-', ''), 'hex'));
  sha.update(Buffer.from(name, 'utf8'));
  const bytes = sha.digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** De `billing.invoice.issued` → { resource: 'invoice', action: 'issued' }.
 *  Funciona para routing keys de 2+ segmentos (recurso = penúltimo, acción =
 *  último); el dominio queda implícito en `event`. */
export function deriveResourceAndAction(routingKey: string): { resource: string; action: string } {
  const segments = routingKey.split('.');
  const action = segments[segments.length - 1] ?? routingKey;
  const resource = segments.length >= 2 ? segments[segments.length - 2] : routingKey;
  return { resource, action };
}

/** Resumen legible para la API (las etiquetas españolizadas viven en el i18n de
 *  la vista futura, no aquí). */
export function summarize(routingKey: string): string {
  const { resource, action } = deriveResourceAndAction(routingKey);
  return `${resource} ${action.replaceAll('_', ' ')}`;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return null;
  return trimmed;
}

/** Posibles ids de recurso afectado dentro del payload. El "target" de la
 *  acción es un best-effort: cada dominio publica el suyo (invoiceId, ...). */
const TARGET_CANDIDATES = [
  'targetId',
  'aggregateId',
  'invoiceId',
  'customerId',
  'productId',
  'establishmentId',
  'emissionPointId',
  'billingPointId',
  'documentTypeId',
  'identificationTypeId',
  'roleId',
  'taxRateId',
  'rateId',
  'countryId',
  'credentialId',
  'posDeviceId',
  'pluginRequestId',
] as const;

function firstTargetId(payload: Record<string, unknown>): string | null {
  for (const key of TARGET_CANDIDATES) {
    const value = asString(payload[key]);
    if (value) return value;
  }
  return null;
}

export interface ExtractAuditEntryInput {
  routingKey: string;
  payload: Record<string, unknown>;
  eventId?: string;
  /** msg.properties.timestamp de AMQP (segundos epoch) — fallback de
   *  occurredAt cuando el payload no lo trae. */
  amqpTimestamp?: number;
  correlationId?: string;
}

/**
 * Normaliza un evento publicado a AUDIT_LOG. Devuelve null cuando el evento no
 * es auditable: sin eventId (imposible deduplicar) o con organizationId
 * "inválido" (presente pero no es texto). Un evento sin organizationId se
 * considera de plataforma (org null) y SÍ se registra — no es lo mismo que
 * inválido.
 */
export function extractAuditEntry(input: ExtractAuditEntryInput): AuditDraft | null {
  const { routingKey, payload, correlationId } = input;
  const eventId = asString(input.eventId);
  if (!eventId) return null;

  const rawOrg = payload.organizationId ?? payload.orgId;
  if (rawOrg !== undefined && rawOrg !== null && !asString(rawOrg)) return null;
  const organizationId = asString(rawOrg);

  // occurred_at es NOT NULL. Orden de preferencia: payload.occurredAt (clock del
  // emisor) → timestamp de AMQP (amqplib lo autocompleta) → reloj del consumidor.
  const occurredAt = toDate(payload.occurredAt, input.amqpTimestamp) ?? new Date();

  const { resource, action } = deriveResourceAndAction(routingKey);

  return {
    id: deterministicUuidV5(`${eventId}:${routingKey}`),
    organizationId,
    userId: asString(payload.userId ?? payload.actorId),
    actorEmail: asString(payload.actorEmail ?? payload.userEmail),
    event: routingKey,
    resource,
    action,
    targetId: firstTargetId(payload),
    ip: asString(payload.ip),
    requestId: asString(payload.requestId ?? payload.correlationId) ?? asString(correlationId),
    payload: Object.keys(payload).length > 0 ? payload : null,
    occurredAt,
  };
}

/** accepted: ISO-8601 (string), ms epoch (number) o Date. Null si no se puede. */
function toDate(value: unknown, amqpTimestamp?: number): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value as string);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (typeof amqpTimestamp === 'number' && amqpTimestamp > 0) {
    return new Date(amqpTimestamp * 1000);
  }
  return null;
}
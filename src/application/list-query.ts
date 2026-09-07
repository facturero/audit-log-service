import { Op } from 'sequelize';

export interface ListParams {
  event?: string;
  userId?: string;
  targetId?: string;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface RangeParams {
  from?: string;
  to?: string;
}

/** Paginación: default 50, tope duro 500. La página la controla `offset` (caer
 *  en la garantía de "1 fila = 1 evento" no tiene sentido aquí; es una bitácora). */
export function normalizePagination(
  limit?: number,
  offset?: number,
): { limit: number; offset: number } {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  return { limit: safeLimit, offset: safeOffset };
}

/** Construye el WHERE de listado. `organizationId` es OBLIGATORIO y nunca se
 *  omite: es el aislamiento por tenant (una org nunca ve los eventos de otra,
 *  ni los de plataforma, que llegan con organization_id = NULL). */
export function buildAuditWhere(
  organizationId: string,
  params: ListParams,
): Record<PropertyKey, unknown> {
  const where: Record<PropertyKey, unknown> = { organizationId };

  if (params.event?.trim()) {
    const event = params.event.trim();
    // Prefijo ("billing.") → LIKE 'billing.%' ; routing key exacta → =.
    where.event = event.endsWith('.') ? { [Op.like]: `${event}%` } : event;
  }
  if (params.userId?.trim()) where.userId = params.userId.trim();
  if (params.targetId?.trim()) where.targetId = params.targetId.trim();

  // Record<PropertyKey, ...> (no Record<string,...>): las claves de operador de
  // Sequelize son unique symbols y éste es el único índice que los admite.
  const occurred: Record<PropertyKey, unknown> = {};
  let hasRange = false;
  if (params.from) {
    occurred[Op.gte] = new Date(params.from);
    hasRange = true;
  }
  if (params.to) {
    occurred[Op.lte] = new Date(params.to);
    hasRange = true;
  }
  if (hasRange) where.occurredAt = occurred;

  if (params.search?.trim()) {
    const term = params.search.trim();
    // JSON LIKE: tactic simple; el conteo exacto de columnas no importa porque
    // el índice por organización ya estrecha antes de tocar el JOIN-less scan.
    where[Op.or] = [
      { payload: { [Op.like]: `%${term}%` } },
      { actorEmail: { [Op.like]: `%${term}%` } },
    ];
  }

  return where;
}

/** Rango para summary: solo se aplica si viene `from`/`to` (ventana opcional). */
export function buildRangeSql(params: RangeParams): { sql: string; replacements: Record<string, unknown> } {
  const clauses: string[] = [];
  const replacements: Record<string, unknown> = {};
  if (params.from) {
    clauses.push('occurred_at >= :from');
    replacements.from = new Date(params.from);
  }
  if (params.to) {
    clauses.push('occurred_at <= :to');
    replacements.to = new Date(params.to);
  }
  return { sql: clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : '', replacements };
}
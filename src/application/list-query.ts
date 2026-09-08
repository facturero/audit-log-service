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
  /** Incluye los eventos de plataforma (organization_id NULL): cambios de
   *  catálogo global (países, tipos de documento...). No son de otro tenant —
   *  no tienen tenant —, así que no rompen el aislamiento. Sin esto quedaban
   *  escritos pero inalcanzables por cualquier endpoint. */
  includePlatform?: boolean;
}

/** `%` y `_` son comodines en LIKE: sin escapar, un `search` con `%` devuelve
 *  la tabla entera y `_` casa con cualquier carácter. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
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
  // Todo cuelga de un Op.and explícito: el filtro de tenant convive con un
  // Op.or (búsqueda, plataforma) sin que ninguno pise la clave del otro.
  // Record<PropertyKey, ...> (no Record<string,...>): las claves de operador de
  // Sequelize son unique symbols y éste es el único índice que los admite.
  const clauses: Array<Record<PropertyKey, unknown>> = [];

  // Aislamiento por tenant. Es la ÚNICA cláusula no negociable: siempre está,
  // y como mucho se amplía a los eventos sin tenant (plataforma).
  clauses.push(
    params.includePlatform
      ? { [Op.or]: [{ organizationId }, { organizationId: null }] }
      : { organizationId },
  );

  if (params.event?.trim()) {
    const event = params.event.trim();
    // Prefijo ("billing.") → LIKE 'billing.%' ; routing key exacta → =.
    clauses.push({
      event: event.endsWith('.') ? { [Op.like]: `${escapeLike(event)}%` } : event,
    });
  }
  if (params.userId?.trim()) clauses.push({ userId: params.userId.trim() });
  if (params.targetId?.trim()) clauses.push({ targetId: params.targetId.trim() });

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
  if (hasRange) clauses.push({ occurredAt: occurred });

  if (params.search?.trim()) {
    const term = `%${escapeLike(params.search.trim())}%`;
    // OJO: el LIKE sobre la columna JSON no puede usar índice — es un scan del
    // subconjunto que ya recortó el índice por organización. Aceptable para
    // una búsqueda puntual; si la bitácora crece, esto pide FULLTEXT o una
    // columna generada.
    clauses.push({
      [Op.or]: [{ payload: { [Op.like]: term } }, { actorEmail: { [Op.like]: term } }],
    });
  }

  return { [Op.and]: clauses };
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
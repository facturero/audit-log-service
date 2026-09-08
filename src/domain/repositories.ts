import { AuditDraft } from './audit-entry.js';
import type { ListParams } from '../application/list-query.js';

/** Fila de AUDIT_LOG tal como la devuelve la persistencia. */
export interface AuditLogRecord {
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
  createdAt: Date;
}

/** Puerto de persistencia. La implementación solo se comunica con audit_db. */
export interface AuditLogRepository {
  insert(draft: AuditDraft): Promise<void>;
  /** Borra lo anterior a `cutoff` (política de retención). Devuelve el nº de filas. */
  deleteOlderThan(cutoff: Date): Promise<number>;
  find(
    organizationId: string,
    params: ListParams,
    limit: number,
    offset: number,
  ): Promise<{ rows: AuditLogRecord[]; total: number }>;
  findById(organizationId: string, id: string): Promise<AuditLogRecord | null>;
  summaryByEvent(
    organizationId: string,
    range: { from?: string; to?: string },
  ): Promise<Array<{ day: string; group: string; count: number }>>;
  summaryByUser(
    organizationId: string,
    range: { from?: string; to?: string },
  ): Promise<Array<{ day: string; group: string; count: number }>>;
}
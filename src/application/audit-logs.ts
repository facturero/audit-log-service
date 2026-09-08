import { AuditDraft, summarize } from '../domain/audit-entry.js';
import { AuditLogRecord, AuditLogRepository } from '../domain/repositories.js';
import { ListParams, normalizePagination } from './list-query.js';

export interface AuditLogListItemDTO {
  id: string;
  event: string;
  resource: string;
  action: string;
  organizationId: string | null;
  userId: string | null;
  userEmail: string | null;
  targetId: string | null;
  ip: string | null;
  requestId: string | null;
  occurredAt: string;
  summary: string;
}

export interface AuditLogDetailDTO extends AuditLogListItemDTO {
  payload: Record<string, unknown> | null;
}

export interface AuditLogPageDTO {
  items: AuditLogListItemDTO[];
  total: number;
  limit: number;
  offset: number;
}

export interface SummaryRowDTO {
  day: string;
  group: string;
  count: number;
}

export interface AuditLogSummaryDTO {
  byEvent: SummaryRowDTO[];
  byUser: SummaryRowDTO[];
}

function toListItem(row: AuditLogRecord): AuditLogListItemDTO {
  return {
    id: row.id,
    event: row.event,
    resource: row.resource,
    action: row.action,
    organizationId: row.organizationId,
    userId: row.userId,
    userEmail: row.actorEmail,
    targetId: row.targetId,
    ip: row.ip,
    requestId: row.requestId,
    occurredAt: row.occurredAt.toISOString(),
    summary: summarize(row.event),
  };
}

export class AuditLogService {
  constructor(private readonly repo: AuditLogRepository) {}

  /** Escritura única: entra SOLO por RabbitMQ (el API no tiene mutación). */
  async record(draft: AuditDraft): Promise<void> {
    await this.repo.insert(draft);
  }

  /**
   * Retención: borra lo anterior a la ventana. Con `retentionDays <= 0` no
   * borra nada — el default es conservar, porque purgar una bitácora sin que
   * alguien lo haya decidido es peor que gastar disco.
   */
  async purge(retentionDays: number): Promise<number> {
    if (retentionDays <= 0) return 0;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    return this.repo.deleteOlderThan(cutoff);
  }

  async list(organizationId: string, params: ListParams): Promise<AuditLogPageDTO> {
    const { limit, offset } = normalizePagination(params.limit, params.offset);
    const { rows, total } = await this.repo.find(organizationId, params, limit, offset);
    return {
      items: rows.map(toListItem),
      total,
      limit,
      offset,
    };
  }

  async getById(organizationId: string, id: string): Promise<AuditLogDetailDTO | null> {
    const row = await this.repo.findById(organizationId, id);
    if (!row) return null;
    return { ...toListItem(row), payload: row.payload };
  }

  async summary(organizationId: string, params: { from?: string; to?: string }): Promise<AuditLogSummaryDTO> {
    const [byEvent, byUser] = await Promise.all([
      this.repo.summaryByEvent(organizationId, params),
      this.repo.summaryByUser(organizationId, params),
    ]);
    return { byEvent, byUser };
  }
}
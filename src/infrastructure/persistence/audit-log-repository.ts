import { QueryTypes } from 'sequelize';
import { AuditDraft } from '../../domain/audit-entry.js';
import { AuditLogRecord, AuditLogRepository } from '../../domain/repositories.js';
import { buildAuditWhere, buildRangeSql, ListParams } from '../../application/list-query.js';
import { AuditLogModel } from './models.js';

function toRecord(row: AuditLogModel): AuditLogRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    actorEmail: row.actorEmail,
    event: row.event,
    resource: row.resource,
    action: row.action,
    targetId: row.targetId,
    ip: row.ip,
    requestId: row.requestId,
    payload: row.payload ?? null,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
  };
}

/**
 * Implementación sobre audit_db. La inserción usa el `id` determinista
 * (eventId + routingKey) con ON DUPLICATE KEY: un reproceso no duplica la
 * fila; la idempotencia gruesa la da processed_events, esta es la red fina.
 */
export class SequelizeAuditLogRepository implements AuditLogRepository {
  async insert(draft: AuditDraft): Promise<void> {
    await AuditLogModel.upsert({
      id: draft.id,
      organizationId: draft.organizationId,
      userId: draft.userId,
      actorEmail: draft.actorEmail,
      event: draft.event,
      resource: draft.resource,
      action: draft.action,
      targetId: draft.targetId,
      ip: draft.ip,
      requestId: draft.requestId,
      payload: draft.payload,
      occurredAt: draft.occurredAt,
    });
  }

  async find(
    organizationId: string,
    params: ListParams,
    limit: number,
    offset: number,
  ): Promise<{ rows: AuditLogRecord[]; total: number }> {
    const where = buildAuditWhere(organizationId, params);
    const { rows, count } = await AuditLogModel.findAndCountAll({
      where,
      order: [
        ['occurredAt', 'DESC'],
        ['id', 'ASC'],
      ],
      limit,
      offset,
    });
    return { rows: rows.map(toRecord), total: count };
  }

  async findById(organizationId: string, id: string): Promise<AuditLogRecord | null> {
    const row = await AuditLogModel.findOne({ where: { id, organizationId } });
    return row ? toRecord(row) : null;
  }

  async summaryByEvent(
    organizationId: string,
    range: { from?: string; to?: string },
  ): Promise<Array<{ day: string; group: string; count: number }>> {
    const { sql, replacements } = buildRangeSql(range);
    const rows = (await AuditLogModel.sequelize!.query(
      `SELECT DATE(occurred_at) AS day, event AS group_name, COUNT(*) AS count
         FROM audit_logs
        WHERE organization_id = :organizationId${sql}
        GROUP BY day, group_name
        ORDER BY day DESC, count DESC
        LIMIT 500`,
      {
        replacements: { organizationId, ...replacements },
        type: QueryTypes.SELECT,
      },
    )) as Array<{ day: string; group_name: string; count: number }>;
    return rows.map((r) => ({ day: r.day, group: r.group_name, count: Number(r.count) }));
  }

  async summaryByUser(
    organizationId: string,
    range: { from?: string; to?: string },
  ): Promise<Array<{ day: string; group: string; count: number }>> {
    const { sql, replacements } = buildRangeSql(range);
    const rows = (await AuditLogModel.sequelize!.query(
      `SELECT DATE(occurred_at) AS day, IFNULL(user_id, 'system') AS group_name, COUNT(*) AS count
         FROM audit_logs
        WHERE organization_id = :organizationId${sql}
        GROUP BY day, group_name
        ORDER BY day DESC, count DESC
        LIMIT 500`,
      {
        replacements: { organizationId, ...replacements },
        type: QueryTypes.SELECT,
      },
    )) as Array<{ day: string; group_name: string; count: number }>;
    return rows.map((r) => ({ day: r.day, group: r.group_name, count: Number(r.count) }));
  }
}
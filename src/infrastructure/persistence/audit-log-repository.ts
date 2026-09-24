import { Op, QueryTypes } from 'sequelize';
import { AuditDraft } from '../../domain/audit-entry.js';
import { AuditLogRecord, AuditLogRepository } from '../../domain/repositories.js';
import { buildAuditWhere, buildAuditWhereSql, buildRangeSql, ListParams } from '../../application/list-query.js';
import { AuditLogModel } from './models.js';
import { CountCache } from './count-cache.js';

// TTL del total del listado (ms). 0 desactiva el cache.
const auditCountCache = new CountCache(Number(process.env.AUDIT_COUNT_CACHE_TTL_MS ?? 10000));

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
 * (eventId + routingKey): un reproceso cae sobre la misma fila; la idempotencia
 * gruesa la da processed_events, ésta es la red fina.
 */
export class SequelizeAuditLogRepository implements AuditLogRepository {
  async insert(draft: AuditDraft): Promise<void> {
    // findOrCreate y NO upsert: la bitácora es inmutable. Con upsert, reprocesar
    // un evento REESCRIBÍA la fila existente — es decir, se podía reescribir la
    // historia republicando el evento. Si ya existe, se deja como está.
    await AuditLogModel.findOrCreate({
      where: { id: draft.id },
      defaults: {
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
      },
    });
  }

  /** Purga por retención. Devuelve cuántas filas se borraron. */
  async deleteOlderThan(cutoff: Date): Promise<number> {
    return AuditLogModel.destroy({ where: { occurredAt: { [Op.lt]: cutoff } } });
  }

  async find(
    organizationId: string,
    params: ListParams,
    limit: number,
    offset: number,
  ): Promise<{ rows: AuditLogRecord[]; total: number }> {
    const where = buildAuditWhere(organizationId, params);
    // Filas por el índice (rápido). El COUNT de findAndCountAll escaneaba TODAS
    // las filas del org (94k+) → 0.7s warm / ~10s en frío y timeouts bajo carga.
    const rows = await AuditLogModel.findAll({
      where,
      // id DESC (no ASC): con ambos DESC el índice (organization_id, occurred_at,
      // id) sirve el orden con un scan hacia atrás y evita el filesort de todas
      // las filas del org (que costaba ~378ms por petición). El id es solo
      // desempate estable, su dirección no cambia la semántica.
      order: [
        ['occurredAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
      offset,
    });
    // COUNT ACOTADO: cuenta hasta CAP+1 y para (el subquery con LIMIT no escanea
    // más). El listado muestra "CAP+" cuando hay más; suficiente para paginar y
    // deja de depender del tamaño total de la bitácora.
    const CAP = 10000;
    const { sql, replacements } = buildAuditWhereSql(organizationId, params);
    // Aun acotado, recorre hasta 10.001 entradas del indice (~13 ms de MySQL por
    // peticion, 10 veces mas que la pagina): se cachea unos segundos por organizacion
    // y filtros (ver count-cache.ts). La pagina de arriba nunca se cachea.
    const total = await auditCountCache.get(
      organizationId,
      JSON.stringify([params.event, params.userId, params.targetId, params.from, params.to, params.search, params.includePlatform]),
      async () => {
        const countRows = (await AuditLogModel.sequelize!.query(
          `SELECT COUNT(*) AS c FROM (SELECT 1 FROM audit_logs WHERE ${sql} LIMIT ${CAP + 1}) t`,
          { replacements, type: QueryTypes.SELECT },
        )) as Array<{ c: number }>;
        return Number(countRows[0]?.c ?? 0);
      },
    );
    return { rows: rows.map(toRecord), total };
  }

  async findById(organizationId: string, id: string): Promise<AuditLogRecord | null> {
    // Los eventos de plataforma (organization_id NULL) también son visibles en
    // detalle: si se listan con includePlatform, abrirlos no puede dar 404.
    const row = await AuditLogModel.findOne({
      where: {
        id,
        [Op.or]: [{ organizationId }, { organizationId: null }],
      },
    });
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
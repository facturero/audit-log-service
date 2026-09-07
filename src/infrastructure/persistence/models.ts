import { Sequelize, DataTypes, Model } from 'sequelize';

const DB_NAME = process.env.DB_NAME || 'audit_db';
const DB_HOST = process.env.DB_HOST || 'mysql';
const DB_PORT = Number(process.env.DB_PORT) || 3306;
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || 'root123';

export const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
  host: DB_HOST,
  port: DB_PORT,
  dialect: 'mysql',
  logging: false,
});

/** Tabla de idempotencia que gestiona la librería @facturero/outbox-relay por
 *  SQL crudo. El modelo existe para que sequelize.sync() la cree en desarrollo;
 *  en producción la crea migrations/20260907100000-create-processed-events.js. */
export class ProcessedEventModel extends Model {
  declare id: string;
  declare eventType: string;
  declare routingKey: string;
  declare payload: string;
  declare status: string;
  declare lastError: string | null;
  declare processedAt: Date;
}

ProcessedEventModel.init(
  {
    id: { type: DataTypes.STRING(36), primaryKey: true },
    eventType: { type: DataTypes.STRING(100), allowNull: false, field: 'event_type' },
    routingKey: { type: DataTypes.STRING(200), allowNull: false, field: 'routing_key' },
    payload: { type: DataTypes.TEXT, allowNull: true },
    status: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: 'processed',
    },
    lastError: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'last_error',
    },
    processedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'processed_at',
    },
  },
  {
    sequelize,
    tableName: 'processed_events',
    timestamps: false,
    indexes: [{ unique: true, fields: ['id'] }],
  },
);

export class AuditLogModel extends Model {
  declare id: string;
  declare organizationId: string | null;
  declare userId: string | null;
  declare actorEmail: string | null;
  declare event: string;
  declare resource: string;
  declare action: string;
  declare targetId: string | null;
  declare ip: string | null;
  declare requestId: string | null;
  declare payload: Record<string, unknown> | null;
  declare occurredAt: Date;
  declare createdAt: Date;
}

AuditLogModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true, allowNull: false },
    organizationId: { type: DataTypes.CHAR(36), allowNull: true, field: 'organization_id' },
    userId: { type: DataTypes.CHAR(36), allowNull: true, field: 'user_id' },
    actorEmail: { type: DataTypes.STRING(254), allowNull: true, field: 'actor_email' },
    event: { type: DataTypes.STRING(200), allowNull: false },
    resource: { type: DataTypes.STRING(100), allowNull: false },
    action: { type: DataTypes.STRING(100), allowNull: false },
    targetId: { type: DataTypes.CHAR(36), allowNull: true, field: 'target_id' },
    ip: { type: DataTypes.STRING(45), allowNull: true },
    requestId: { type: DataTypes.STRING(100), allowNull: true, field: 'request_id' },
    payload: { type: DataTypes.JSON, allowNull: true },
    occurredAt: { type: DataTypes.DATE, allowNull: false, field: 'occurred_at' },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: 'created_at', defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    tableName: 'audit_logs',
    timestamps: false,
    indexes: [
      { name: 'audit_logs_org_occurred', fields: ['organizationId', 'occurredAt'] },
      { name: 'audit_logs_org_event_occurred', fields: ['organizationId', 'event', 'occurredAt'] },
      { name: 'audit_logs_org_user_occurred', fields: ['organizationId', 'userId', 'occurredAt'] },
    ],
  },
);
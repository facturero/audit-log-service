'use strict';

/** Bitácora de auditoría.
 *
 * - `id` es DETERMINISTA: uuid v5 derivado de (eventId, routingKey). Reprocesar
 *   el mismo evento cae sobre la misma fila (los INSERT usan ON DUPLICATE).
 * - `organization_id` es el tenant: toda consulta por API filtra por él y los
 *   eventos de plataforma (NULL) no se listan a organizaciones.
 * - `event` guarda la routing key completa (billing.invoice.issued); resource y
 *   action se derivan de ella para filtrar/agrupar sin parsear.
 * - `payload` es el subset del evento publicado (JSON). El resto de columnas
 *   (usuario, ip, request_id) son opcionales: solo se llenan si el emisor las
 *   propagó.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('audit_logs', {
      id: {
        type: Sequelize.CHAR(36),
        primaryKey: true,
        allowNull: false,
      },
      organization_id: {
        type: Sequelize.CHAR(36),
        allowNull: true,
      },
      user_id: {
        type: Sequelize.CHAR(36),
        allowNull: true,
      },
      actor_email: {
        type: Sequelize.STRING(254),
        allowNull: true,
      },
      event: {
        type: Sequelize.STRING(200),
        allowNull: false,
      },
      resource: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      action: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      target_id: {
        type: Sequelize.CHAR(36),
        allowNull: true,
      },
      ip: {
        type: Sequelize.STRING(45),
        allowNull: true,
      },
      request_id: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      payload: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      occurred_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    // Índices por consulta (ver diseño servicos/audit-log-service.md). El
    // leading column es SIEMPRE organization_id (tenant).
    await queryInterface.addIndex('audit_logs', ['organization_id', 'occurred_at'], {
      name: 'audit_logs_org_occurred',
    });
    await queryInterface.addIndex('audit_logs', ['organization_id', 'event', 'occurred_at'], {
      name: 'audit_logs_org_event_occurred',
    });
    await queryInterface.addIndex('audit_logs', ['organization_id', 'user_id', 'occurred_at'], {
      name: 'audit_logs_org_user_occurred',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('audit_logs');
  },
};
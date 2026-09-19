/** @type {import('sequelize-cli').Migration} */
module.exports = {
  // El listado ordena por occurred_at DESC, id DESC. El índice antiguo
  // (organization_id, occurred_at) no cubría el id → filesort de todas las filas
  // del org por petición (~378ms). Este lo incluye y lo sirve con index scan.
  async up(queryInterface) {
    await queryInterface.addIndex('audit_logs', ['organization_id', 'occurred_at', 'id'], {
      name: 'audit_logs_org_occurred_id',
    });
    // El anterior queda cubierto por el prefijo del nuevo; se elimina si existe.
    try {
      await queryInterface.removeIndex('audit_logs', 'audit_logs_org_occurred');
    } catch (e) {
      /* no existía: ok */
    }
  },

  async down(queryInterface) {
    await queryInterface.addIndex('audit_logs', ['organization_id', 'occurred_at'], {
      name: 'audit_logs_org_occurred',
    });
    await queryInterface.removeIndex('audit_logs', 'audit_logs_org_occurred_id');
  },
};

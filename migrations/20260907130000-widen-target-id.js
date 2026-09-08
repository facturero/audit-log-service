'use strict';

/** `target_id` era CHAR(36) asumiendo que todo id afectado es un uuid, pero
 *  `firstTargetId` es best-effort sobre el payload y hay dominios que publican
 *  ids que no lo son (códigos de dispositivo, claves compuestas). Con CHAR(36)
 *  MySQL trunca en modo laxo y falla el INSERT en modo estricto — es decir, se
 *  perdía la fila de auditoría entera por un campo accesorio. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('audit_logs', 'target_id', {
      type: Sequelize.STRING(128),
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('audit_logs', 'target_id', {
      type: Sequelize.CHAR(36),
      allowNull: true,
    });
  },
};

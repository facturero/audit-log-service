const { Sequelize } = require('sequelize');

module.exports = {
  username: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root123',
  database: process.env.DB_NAME || 'audit_db',
  host: process.env.DB_HOST || 'mysql',
  port: Number(process.env.DB_PORT) || 3306,
  dialect: 'mysql',
  migrationStorageTableName: 'sequelize_meta',
};
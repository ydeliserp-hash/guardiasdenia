'use strict';

const { createApp } = require('./app');
const env = require('./config/env');
const { pool } = require('./config/db');

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`🩺 API de guardias escuchando en http://localhost:${env.port} (entorno: ${env.nodeEnv})`);
});

// Cierre ordenado.
function shutdown(signal) {
  console.log(`\n${signal} recibido. Cerrando servidor…`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = server;

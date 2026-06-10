'use strict';

const { Pool, types } = require('pg');
const env = require('./env');

// Devolver las columnas DATE (OID 1082) como string 'YYYY-MM-DD' tal cual,
// sin convertir a Date (evita desfases de zona horaria al comparar días).
types.setTypeParser(1082, (val) => val);

// Opciones comunes: SSL (gestionadas como Supabase lo exigen) y tamaño de pool
// (en serverless conviene max=1 para no agotar conexiones del pooler).
const comun = {
  ...(env.pgSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  ...(env.pgPoolMax ? { max: env.pgPoolMax } : {}),
};

const pool = env.databaseUrl
  ? new Pool({ connectionString: env.databaseUrl, ...comun })
  : new Pool({
      host: env.pg.host,
      port: env.pg.port,
      user: env.pg.user,
      password: env.pg.password,
      database: env.pg.database,
      ...comun,
    });

pool.on('error', (err) => {
  // Errores de clientes inactivos en el pool: log y continuar.
  console.error('Error inesperado en el pool de PostgreSQL:', err.message);
});

/**
 * Ejecuta una consulta simple usando el pool.
 */
async function query(text, params) {
  return pool.query(text, params);
}

/**
 * Ejecuta `fn(client)` dentro de una transacción. Hace COMMIT si resuelve
 * y ROLLBACK si lanza. Devuelve lo que devuelva `fn`.
 *
 * Toda la lógica de negocio que escribe AuditLog debe correr aquí dentro
 * para garantizar que el log y el cambio se confirman juntos.
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Error al hacer ROLLBACK:', rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };

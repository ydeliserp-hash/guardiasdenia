'use strict';

/**
 * Runner de migraciones minimalista.
 *
 *   node src/db/migrate.js           → aplica las migraciones pendientes
 *   node src/db/migrate.js --reset   → borra el esquema 'public' y reaplica todo
 *
 * Las migraciones son archivos .sql en src/db/migrations, ordenados por nombre.
 * Se registra cada migración aplicada en la tabla schema_migrations.
 */

const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      nombre      TEXT PRIMARY KEY,
      aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function resetSchema(client) {
  console.log('⚠️  --reset: borrando y recreando el esquema public…');
  await client.query('DROP SCHEMA public CASCADE;');
  await client.query('CREATE SCHEMA public;');
}

async function appliedMigrations(client) {
  const { rows } = await client.query('SELECT nombre FROM schema_migrations;');
  return new Set(rows.map((r) => r.nombre));
}

async function run() {
  const reset = process.argv.includes('--reset');
  const client = await pool.connect();
  try {
    if (reset) {
      await resetSchema(client);
    }
    await ensureMigrationsTable(client);
    const done = await appliedMigrations(client);

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let count = 0;
    for (const file of files) {
      if (done.has(file)) {
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`▶  Aplicando migración: ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (nombre) VALUES ($1);', [file]);
        await client.query('COMMIT');
        count += 1;
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Fallo en la migración ${file}: ${err.message}`);
      }
    }

    if (count === 0) {
      console.log('✓ No hay migraciones pendientes.');
    } else {
      console.log(`✓ ${count} migración(es) aplicada(s).`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('✖ Error en las migraciones:', err.message);
  process.exit(1);
});

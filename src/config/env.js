'use strict';

const path = require('path');
const dotenv = require('dotenv');

// Carga .env desde la raíz del backend (un nivel por encima de src/).
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Falta la variable de entorno obligatoria: ${name}`);
  }
  return value;
}

// ¿Hay que conectar a Postgres por SSL? Supabase (y la mayoría de BD gestionadas)
// lo exigen. Por defecto: SSL salvo que el destino sea local. Se puede forzar
// con PGSSL=true|false.
function detectSsl() {
  const explicit = process.env.PGSSL;
  if (explicit !== undefined && explicit !== '') {
    return ['1', 'true', 'require', 'yes', 'on'].includes(explicit.toLowerCase());
  }
  const target = process.env.DATABASE_URL || process.env.PGHOST || 'localhost';
  return !/localhost|127\.0\.0\.1|::1/.test(target);
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  corsOrigin: process.env.CORS_ORIGIN || '*',

  databaseUrl: process.env.DATABASE_URL || null,
  pg: {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432', 10),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'guardias_denia',
  },
  // SSL para la BD (true contra Supabase / hosts no locales).
  pgSsl: detectSsl(),
  // Tamaño máximo del pool. En serverless (Vercel) conviene PG_POOL_MAX=1
  // y usar el pooler de transacciones de Supabase (puerto 6543).
  pgPoolMax: process.env.PG_POOL_MAX ? parseInt(process.env.PG_POOL_MAX, 10) : null,

  jwtSecret: required('JWT_SECRET', 'dev-secret-no-usar-en-produccion'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  jwtTempExpiresIn: process.env.JWT_TEMP_EXPIRES_IN || '15m',

  seedPassword: process.env.SEED_PASSWORD || 'Denia2026!',

  // Token compartido para el enlace público de SOLO LECTURA (/publico/guardias),
  // que la app de turnos de Anestesia usa para mostrar el residente de guardia de
  // cada día. Si no se define, el enlace público queda DESACTIVADO (devuelve 401).
  feedToken: process.env.FEED_TOKEN || null,
};

module.exports = env;

'use strict';

/**
 * Genera `backend/supabase_setup.sql`: un único archivo que CREA el esquema y
 * SIEMBRA todos los datos del prototipo. Pensado para pegarlo en el SQL Editor
 * de Supabase y pulsar "Run" (sin terminal ni connection string).
 *
 *   node src/db/gen-supabase-sql.js
 *
 * La contraseña de los 9 usuarios se hashea aquí (bcrypt) y se incrusta en el SQL.
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const env = require('../config/env');
const { jun, USERS, SHIFTS, STATS, REQUESTS, NOTIS } = require('./seed-data');

const PLAN_ID = '00000000-0000-4000-8000-000000000001';

// --- Helpers de escape SQL ---
const q = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const jsonb = (obj) => (obj == null ? 'NULL' : `${q(JSON.stringify(obj))}::jsonb`);
const bool = (b) => (b ? 'TRUE' : 'FALSE');
const intervalHoras = (h) => `now() - interval '${h} hours'`;
const intervalMin = (m) => `now() - interval '${m} minutes'`;

function build() {
  // Concatena TODAS las migraciones en orden (001, 002, ...).
  const dir = path.join(__dirname, 'migrations');
  const schema = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim())
    .join('\n\n');
  const hash = bcrypt.hashSync(env.seedPassword, 10);
  const reqByKey = Object.fromEntries(REQUESTS.map((r) => [r.key, r.id]));

  const L = [];
  L.push('-- ============================================================================');
  L.push('-- guardias-residentes — ESQUEMA + DATOS (Supabase). Pega TODO y pulsa Run.');
  L.push(`-- Contraseña de los 9 usuarios de ejemplo: ${env.seedPassword}`);
  L.push('-- Generado por src/db/gen-supabase-sql.js — re-ejecutable (hace TRUNCATE).');
  L.push('-- ============================================================================');
  L.push('');
  L.push('-- ----------------------------------------------------------------------------');
  L.push('-- 1) ESQUEMA');
  L.push('-- ----------------------------------------------------------------------------');
  L.push(schema.trim());
  L.push('');
  L.push('-- ----------------------------------------------------------------------------');
  L.push('-- 2) DATOS DE EJEMPLO');
  L.push('-- ----------------------------------------------------------------------------');
  L.push('TRUNCATE notifications, audit_log, shifts, change_requests, year_stats, month_plans, users RESTART IDENTITY CASCADE;');
  L.push('');

  // Usuarios + auditoría de alta
  L.push('-- Usuarios (password_hash bcrypt embebido)');
  for (const u of USERS) {
    L.push(
      'INSERT INTO users (id, nombre, trato, iniciales, dni, password_hash, role, anio, color, hace_guardias, aplica_limites, activo, activation_code) VALUES ('
      + `${q(u.id)}, ${q(u.nombre)}, ${q(u.trato)}, ${q(u.ini)}, ${q(u.dni)}, ${q(hash)}, ${q(u.role)}, ${q(u.anio)}, ${q(u.color)}, ${bool(u.guardias)}, ${bool(u.limites)}, TRUE, NULL);`,
    );
  }
  L.push('');
  for (const u of USERS) {
    L.push(
      'INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_nuevo, detalle, creado_en) VALUES ('
      + `'usuario', ${q(u.id)}, 'alta_usuario', 'carmen', 'activo', ${jsonb({ nombre: u.nombre, role: u.role, color: u.color })}, ${intervalHoras(240)});`,
    );
  }
  L.push('');

  // Contadores anuales
  L.push('-- Contadores anuales (year_stats)');
  for (const anio of Object.keys(STATS)) {
    for (const [uid, s] of Object.entries(STATS[anio])) {
      L.push(
        'INSERT INTO year_stats (user_id, anio, guardias_anio, vi, sa, do_) VALUES ('
        + `${q(uid)}, ${anio}, ${s.anio}, ${s.vi}, ${s.sa}, ${s.do});`,
      );
    }
  }
  L.push('');

  // Planilla junio 2026 (publicada)
  L.push('-- Planilla junio 2026 (publicada por la tutora)');
  L.push(
    'INSERT INTO month_plans (id, anio, mes, estado, publicado_por, publicado_en) VALUES ('
    + `${q(PLAN_ID)}, 2026, 6, 'publicado', 'carmen', ${intervalHoras(6)});`,
  );
  L.push(
    'INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_anterior, estado_nuevo, detalle, creado_en) VALUES ('
    + `'planilla', ${q(PLAN_ID)}, 'publicada', 'carmen', 'borrador', 'publicado', ${jsonb({ anio: 2026, mes: 6 })}, ${intervalHoras(6)});`,
  );
  L.push('');

  // Guardias de junio
  L.push('-- Guardias de junio 2026');
  for (const [dia, ids] of Object.entries(SHIFTS)) {
    let slot = 1;
    for (const uid of ids) {
      L.push(
        'INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('
        + `${q(jun(Number(dia)))}, ${q(uid)}, ${q(PLAN_ID)}, ${slot});`,
      );
      slot += 1;
    }
  }
  L.push('');

  // Solicitudes + auditoría
  L.push('-- Solicitudes rq1..rq6 (5 estados; rq4 con flag_exceso)');
  for (const r of REQUESTS) {
    const baseMin = r.horas * 60;
    L.push(
      'INSERT INTO change_requests (id, tipo, de_user_id, a_user_id, guardia_de, guardia_a, estado, flag_exceso, nota, motivo, creada_en, updated_at) VALUES ('
      + `${q(r.id)}, ${q(r.tipo)}, ${q(r.de)}, ${q(r.a)}, ${q(r.guardiaDe)}, ${q(r.guardiaA)}, ${q(r.estado)}, ${jsonb(r.flag)}, ${q(r.nota)}, ${q(r.motivo)}, ${intervalHoras(r.horas)}, ${intervalHoras(r.horas)});`,
    );
    // creada
    L.push(
      'INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_nuevo, detalle, creado_en) VALUES ('
      + `'solicitud', ${q(r.id)}, 'creada', ${q(r.de)}, 'pend_companero', ${jsonb({ tipo: r.tipo, de: r.de, a: r.a, guardia_de: r.guardiaDe, guardia_a: r.guardiaA, flag_exceso: r.flag })}, ${intervalHoras(r.horas)});`,
    );
    if (['pend_tutor', 'aprobada'].includes(r.estado)) {
      L.push(
        'INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_anterior, estado_nuevo, detalle, creado_en) VALUES ('
        + `'solicitud', ${q(r.id)}, 'aceptada', ${q(r.a)}, 'pend_companero', 'pend_tutor', ${jsonb({ aceptado_por: r.a, flag_exceso: r.flag })}, ${intervalMin(baseMin - 30)});`,
      );
    }
    if (r.estado === 'aprobada') {
      L.push(
        'INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_anterior, estado_nuevo, detalle, creado_en) VALUES ('
        + `'solicitud', ${q(r.id)}, 'aprobada', 'carmen', 'pend_tutor', 'aprobada', ${jsonb({ tipo: r.tipo, solicitante: r.de, companero: r.a, tutor: 'carmen', guardia_de: r.guardiaDe, guardia_a: r.guardiaA, flag_exceso: r.flag, forzado_pese_a_exceso: false })}, ${intervalMin(baseMin - 60)});`,
      );
    }
    if (r.estado === 'rechazada') {
      L.push(
        'INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_anterior, estado_nuevo, detalle, creado_en) VALUES ('
        + `'solicitud', ${q(r.id)}, 'rechazada', ${q(r.a)}, 'pend_companero', 'rechazada', ${jsonb({ rechazado_por: r.a, motivo: r.motivo })}, ${intervalMin(baseMin - 30)});`,
      );
    }
    if (r.estado === 'cancelada') {
      L.push(
        'INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_anterior, estado_nuevo, detalle, creado_en) VALUES ('
        + `'solicitud', ${q(r.id)}, 'cancelada', ${q(r.de)}, 'pend_companero', 'cancelada', ${jsonb({ cancelado_por: r.de })}, ${intervalMin(baseMin - 30)});`,
      );
    }
  }
  L.push('');

  // Notificaciones de lucia
  L.push('-- Notificaciones del residente actual (lucia)');
  for (const n of NOTIS) {
    const ref = n.ref ? q(reqByKey[n.ref]) : 'NULL';
    L.push(
      'INSERT INTO notifications (user_id, tipo, icono, titulo, cuerpo, leida, ref_request_id, creada_en) VALUES ('
      + `'lucia', ${q(n.tipo)}, ${q(n.icono)}, ${q(n.titulo)}, ${q(n.cuerpo)}, ${bool(n.leida)}, ${ref}, ${intervalHoras(n.horas)});`,
    );
  }
  L.push('');
  L.push('-- ✓ Listo. Usuarios de prueba (contraseña arriba): DNI 53110874P = Lucía, 21456789X = Carmen (tutora).');
  L.push('');

  return L.join('\n');
}

const sql = build();
const outPath = path.join(__dirname, '..', '..', 'supabase_setup.sql');
fs.writeFileSync(outPath, sql, 'utf8');
console.log(`✓ Generado ${outPath} (${sql.length} caracteres)`);

'use strict';

/**
 * Seed que reproduce EXACTAMENTE el prototipo (mock.js) vía Node/pg.
 * Los datos viven en ./seed-data.js (compartidos con el generador de SQL).
 *
 * Los 9 usuarios se siembran con contraseña por defecto (SEED_PASSWORD) para que
 * el frontend funcione al instante. El flujo de PRIMER ACCESO con código se puede
 * probar dando de alta un usuario nuevo con POST /usuarios (devuelve su código).
 *
 * AVISO: este script hace TRUNCATE de todas las tablas de datos (incluido el
 * histórico) para poder re-sembrar en desarrollo. No usar en producción.
 */

const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const env = require('../config/env');
const { USERS, SHIFTS, STATS, REQUESTS, NOTIS } = require('./seed-data');

const jun = (d) => `2026-06-${String(d).padStart(2, '0')}`;
const ago = (horas) => new Date(Date.now() - horas * 3600 * 1000);

async function audit(client, entry) {
  await client.query(
    `INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_anterior, estado_nuevo, detalle, creado_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      entry.entidad, String(entry.entidadId), entry.accion, entry.actorId || null,
      entry.estadoAnterior || null, entry.estadoNuevo || null,
      entry.detalle ? JSON.stringify(entry.detalle) : null,
      entry.creadoEn || new Date(),
    ],
  );
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Limpieza (idempotencia en desarrollo).
    await client.query(`TRUNCATE notifications, audit_log, shifts, change_requests,
                        year_stats, month_plans, users RESTART IDENTITY CASCADE`);

    const passwordHash = await bcrypt.hash(env.seedPassword, 10);

    // 1) Usuarios
    for (const u of USERS) {
      await client.query(
        `INSERT INTO users (id, nombre, trato, iniciales, dni, password_hash, role, anio, color, hace_guardias, aplica_limites, activo, activation_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,NULL)`,
        [u.id, u.nombre, u.trato, u.ini, u.dni, passwordHash, u.role, u.anio, u.color, u.guardias, u.limites],
      );
      await audit(client, {
        entidad: 'usuario', entidadId: u.id, accion: 'alta_usuario', actorId: 'carmen',
        estadoNuevo: 'activo', detalle: { nombre: u.nombre, role: u.role, color: u.color }, creadoEn: ago(240),
      });
    }

    // 2) Contadores anuales
    for (const anio of Object.keys(STATS)) {
      for (const [uid, s] of Object.entries(STATS[anio])) {
        await client.query(
          'INSERT INTO year_stats (user_id, anio, guardias_anio, vi, sa, do_) VALUES ($1,$2,$3,$4,$5,$6)',
          [uid, Number(anio), s.anio, s.vi, s.sa, s.do],
        );
      }
    }

    // 3) Planilla de junio 2026 (publicada por la tutora)
    const planRes = await client.query(
      `INSERT INTO month_plans (anio, mes, estado, publicado_por, publicado_en)
       VALUES (2026, 6, 'publicado', 'carmen', $1) RETURNING id`,
      [ago(6)],
    );
    const planId = planRes.rows[0].id;
    await audit(client, {
      entidad: 'planilla', entidadId: planId, accion: 'publicada', actorId: 'carmen',
      estadoAnterior: 'borrador', estadoNuevo: 'publicado', detalle: { anio: 2026, mes: 6 }, creadoEn: ago(6),
    });

    // 4) Guardias de junio
    for (const [dia, ids] of Object.entries(SHIFTS)) {
      let slot = 1;
      for (const uid of ids) {
        await client.query(
          'INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ($1,$2,$3,$4)',
          [jun(Number(dia)), uid, planId, slot],
        );
        slot += 1;
      }
    }

    // 5) Solicitudes + su histórico de auditoría (IDs fijos de seed-data)
    for (const r of REQUESTS) {
      const creada = ago(r.horas);
      await client.query(
        `INSERT INTO change_requests (id, tipo, de_user_id, a_user_id, guardia_de, guardia_a, estado, flag_exceso, nota, motivo, creada_en, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
        [r.id, r.tipo, r.de, r.a, r.guardiaDe, r.guardiaA, r.estado, r.flag ? JSON.stringify(r.flag) : null, r.nota, r.motivo, creada],
      );

      await audit(client, {
        entidad: 'solicitud', entidadId: r.id, accion: 'creada', actorId: r.de,
        estadoNuevo: 'pend_companero',
        detalle: { tipo: r.tipo, de: r.de, a: r.a, guardia_de: r.guardiaDe, guardia_a: r.guardiaA, flag_exceso: r.flag },
        creadoEn: creada,
      });
      if (['pend_tutor', 'aprobada'].includes(r.estado)) {
        await audit(client, {
          entidad: 'solicitud', entidadId: r.id, accion: 'aceptada', actorId: r.a,
          estadoAnterior: 'pend_companero', estadoNuevo: 'pend_tutor',
          detalle: { aceptado_por: r.a, flag_exceso: r.flag }, creadoEn: new Date(creada.getTime() + 30 * 60000),
        });
      }
      if (r.estado === 'aprobada') {
        await audit(client, {
          entidad: 'solicitud', entidadId: r.id, accion: 'aprobada', actorId: 'carmen',
          estadoAnterior: 'pend_tutor', estadoNuevo: 'aprobada',
          detalle: {
            tipo: r.tipo, solicitante: r.de, companero: r.a, tutor: 'carmen',
            guardia_de: r.guardiaDe, guardia_a: r.guardiaA, flag_exceso: r.flag, forzado_pese_a_exceso: false,
          },
          creadoEn: new Date(creada.getTime() + 60 * 60000),
        });
      }
      if (r.estado === 'rechazada') {
        await audit(client, {
          entidad: 'solicitud', entidadId: r.id, accion: 'rechazada', actorId: r.a,
          estadoAnterior: 'pend_companero', estadoNuevo: 'rechazada',
          detalle: { rechazado_por: r.a, motivo: r.motivo }, creadoEn: new Date(creada.getTime() + 30 * 60000),
        });
      }
      if (r.estado === 'cancelada') {
        await audit(client, {
          entidad: 'solicitud', entidadId: r.id, accion: 'cancelada', actorId: r.de,
          estadoAnterior: 'pend_companero', estadoNuevo: 'cancelada',
          detalle: { cancelado_por: r.de }, creadoEn: new Date(creada.getTime() + 30 * 60000),
        });
      }
    }

    const reqByKey = Object.fromEntries(REQUESTS.map((r) => [r.key, r.id]));

    // 6) Notificaciones de lucia
    for (const n of NOTIS) {
      await client.query(
        `INSERT INTO notifications (user_id, tipo, icono, titulo, cuerpo, leida, ref_request_id, creada_en)
         VALUES ('lucia',$1,$2,$3,$4,$5,$6,$7)`,
        [n.tipo, n.icono, n.titulo, n.cuerpo, n.leida, n.ref ? reqByKey[n.ref] : null, ago(n.horas)],
      );
    }

    await client.query('COMMIT');
    console.log('✓ Seed completado:');
    console.log(`  • ${USERS.length} usuarios (contraseña por defecto: "${env.seedPassword}")`);
    console.log('  • Planilla junio 2026 publicada + guardias');
    console.log('  • Contadores 2025 y 2026 (Aitana sábados 8/8 ámbar, Nerea viernes 9/8 rojo)');
    console.log(`  • ${REQUESTS.length} solicitudes en los 5 estados (rq4 con flag_exceso)`);
    console.log(`  • ${NOTIS.length} notificaciones para "lucia" + histórico de auditoría`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('✖ Error en el seed:', err.message);
  process.exit(1);
});

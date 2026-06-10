'use strict';

/**
 * Tareas programadas (las dispara el cron de Vercel una vez al día, ~20:00
 * hora española). Idempotentes: cada aviso se deduplica contra las
 * notificaciones ya creadas hoy, así que llamarlas dos veces no duplica nada
 * (por eso el endpoint puede ser público sin riesgo; si existe CRON_SECRET,
 * además se exige).
 *
 *  1) Recordatorio de guardia: a quien tiene guardia MAÑANA (plan publicado).
 *  2) Solicitudes olvidadas: pendientes del tutor (o del compañero) >48 h.
 */

const express = require('express');
const { query } = require('../config/db');
const asyncHandler = require('../middleware/asyncHandler');
const { errores } = require('../utils/errors');
const { crearNotificacion } = require('../services/notifications');
const { enviarPush } = require('../services/push');
const { shortLabel, toISODate } = require('../utils/dates');

const router = express.Router();

/** Cliente "plano" para los servicios que esperan un client de transacción. */
const db = { query };

/** ¿Ya se le creó hoy una notificación igual? (dedupe del cron) */
async function yaAvisadoHoy(userId, { refRequestId = null, tituloPrefijo = null } = {}) {
  const { rows } = await query(
    `SELECT 1 FROM notifications
      WHERE user_id = $1
        AND tipo = 'recordatorio'
        AND creada_en >= CURRENT_DATE
        AND ($2::uuid IS NULL OR ref_request_id = $2)
        AND ($3::text IS NULL OR titulo LIKE $3 || '%')
      LIMIT 1`,
    [userId, refRequestId, tituloPrefijo],
  );
  return rows.length > 0;
}

router.get(
  '/diarias',
  asyncHandler(async (req, res) => {
    // Si hay CRON_SECRET configurado en Vercel, se exige.
    const secreto = process.env.CRON_SECRET;
    if (secreto && req.headers.authorization !== `Bearer ${secreto}`) {
      throw errores.noAutorizado('Tarea programada: credencial inválida.');
    }

    let recordatorios = 0;
    let avisosTutor = 0;
    let avisosCompanero = 0;

    // ---- 1) Recordatorio de guardia (mañana, solo planes publicados) ----
    const { rows: guardiasManana } = await query(
      `SELECT s.fecha, s.user_id, u.nombre
         FROM shifts s
         JOIN users u ON u.id = s.user_id AND u.activo
         JOIN month_plans p ON p.id = s.plan_id AND p.estado = 'publicado'
        WHERE s.fecha = CURRENT_DATE + 1`,
    );
    for (const g of guardiasManana) {
      if (await yaAvisadoHoy(g.user_id, { tituloPrefijo: 'Recordatorio de guardia' })) continue;
      const compa = guardiasManana.find((x) => x.user_id !== g.user_id);
      const cuerpo = compa
        ? `Mañana (${shortLabel(toISODate(g.fecha))}) tienes guardia junto a ${compa.nombre}.`
        : `Mañana (${shortLabel(toISODate(g.fecha))}) tienes guardia.`;
      await crearNotificacion(db, {
        userId: g.user_id,
        tipo: 'recordatorio',
        icono: 'bell',
        titulo: 'Recordatorio de guardia',
        cuerpo,
      });
      await enviarPush(g.user_id, { titulo: 'Recordatorio de guardia', cuerpo, url: '/' });
      recordatorios += 1;
    }

    // ---- 2) Solicitudes paradas >48 h ----
    const { rows: paradas } = await query(
      `SELECT cr.id, cr.estado, cr.a_user_id, de.nombre AS de_nombre, a.nombre AS a_nombre
         FROM change_requests cr
         JOIN users de ON de.id = cr.de_user_id
         JOIN users a  ON a.id  = cr.a_user_id
        WHERE cr.estado IN ('pend_tutor', 'pend_companero')
          AND cr.updated_at < now() - interval '48 hours'`,
    );

    const { rows: tutores } = await query(
      "SELECT id FROM users WHERE role = 'tutor' AND activo",
    );

    for (const s of paradas) {
      if (s.estado === 'pend_tutor') {
        const cuerpo = `La solicitud de ${s.de_nombre} a ${s.a_nombre} lleva más de 2 días esperando tu aprobación.`;
        for (const t of tutores) {
          if (await yaAvisadoHoy(t.id, { refRequestId: s.id })) continue;
          await crearNotificacion(db, {
            userId: t.id,
            tipo: 'recordatorio',
            icono: 'clock',
            titulo: 'Solicitud esperando tu aprobación',
            cuerpo,
            refRequestId: s.id,
          });
          await enviarPush(t.id, { titulo: 'Solicitud esperando tu aprobación', cuerpo, url: '/' });
          avisosTutor += 1;
        }
      } else {
        // pend_companero: recordatorio al destinatario
        if (await yaAvisadoHoy(s.a_user_id, { refRequestId: s.id })) continue;
        const cuerpo = `${s.de_nombre} sigue esperando tu respuesta desde hace más de 2 días.`;
        await crearNotificacion(db, {
          userId: s.a_user_id,
          tipo: 'recordatorio',
          icono: 'clock',
          titulo: 'Tienes una solicitud sin responder',
          cuerpo,
          refRequestId: s.id,
        });
        await enviarPush(s.a_user_id, { titulo: 'Tienes una solicitud sin responder', cuerpo, url: '/' });
        avisosCompanero += 1;
      }
    }

    res.json({
      ok: true,
      recordatorios_guardia: recordatorios,
      avisos_tutor: avisosTutor,
      avisos_companero: avisosCompanero,
    });
  }),
);

module.exports = router;

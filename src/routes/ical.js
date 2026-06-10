'use strict';

/**
 * Calendario personal (iCal) por suscripción.
 *
 * Las apps de calendario (Apple/Google) no pueden mandar el token JWT, así
 * que cada usuario tiene una URL propia firmada con HMAC derivado del
 * JWT_SECRET (no se almacena nada). Solo expone SUS guardias de planes
 * publicados. Se actualiza solo: el calendario del móvil refresca el feed
 * periódicamente.
 */

const express = require('express');
const crypto = require('crypto');

const env = require('../config/env');
const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { errores } = require('../utils/errors');
const { toISODate, addDays } = require('../utils/dates');

const router = express.Router();

/** Firma estable por usuario (no caduca; rota si cambia JWT_SECRET). */
function firmaDe(userId) {
  return crypto.createHmac('sha256', env.jwtSecret)
    .update('ical:' + userId)
    .digest('hex')
    .slice(0, 32);
}

// GET /ical/enlace — (auth) devuelve la URL de suscripción del usuario actual.
router.get(
  '/enlace',
  requireAuth,
  asyncHandler(async (req, res) => {
    const host = req.get('host');
    const base = `https://${host}/ical/${encodeURIComponent(req.user.id)}/${firmaDe(req.user.id)}.ics`;
    res.json({
      url: base,
      webcal: base.replace(/^https:\/\//, 'webcal://'),
    });
  }),
);

// GET /ical/:uid/:firma.ics — feed público firmado (sin JWT).
router.get(
  '/:uid/:firma.ics',
  asyncHandler(async (req, res) => {
    const { uid, firma } = req.params;
    const esperada = firmaDe(uid);
    if (firma.length !== esperada.length
      || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) {
      throw errores.noAutorizado('Enlace de calendario inválido.');
    }

    const { rows: userRows } = await query(
      'SELECT id, nombre FROM users WHERE id = $1 AND activo', [uid],
    );
    if (!userRows[0]) throw errores.noEncontrado('Usuario no encontrado.');

    // Sus guardias: desde hace 2 meses, solo planes publicados.
    const desde = addDays(toISODate(new Date()), -62);
    const { rows: guardias } = await query(
      `SELECT s.id, s.fecha,
              (SELECT u2.nombre FROM shifts s2 JOIN users u2 ON u2.id = s2.user_id
                WHERE s2.fecha = s.fecha AND s2.user_id <> s.user_id LIMIT 1) AS companero
         FROM shifts s
         JOIN month_plans p ON p.id = s.plan_id AND p.estado = 'publicado'
        WHERE s.user_id = $1 AND s.fecha >= $2
        ORDER BY s.fecha`,
      [uid, desde],
    );

    const fmt = (iso) => iso.replace(/-/g, '');
    const ahora = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const L = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Guardias H.U. Denia//ES',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Guardias · H.U. Dénia',
      'X-WR-TIMEZONE:Europe/Madrid',
      'X-PUBLISHED-TTL:PT6H',
      'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    ];
    for (const g of guardias) {
      const fecha = toISODate(g.fecha);
      L.push(
        'BEGIN:VEVENT',
        `UID:${g.id}@guardiasdenia`,
        `DTSTAMP:${ahora}`,
        `DTSTART;VALUE=DATE:${fmt(fecha)}`,
        `DTEND;VALUE=DATE:${fmt(addDays(fecha, 1))}`,
        `SUMMARY:Guardia${g.companero ? ' (con ' + g.companero + ')' : ''}`,
        'DESCRIPTION:Guardia de residentes · Hospital Universitario de Dénia',
        'END:VEVENT',
      );
    }
    L.push('END:VCALENDAR');

    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(L.join('\r\n') + '\r\n');
  }),
);

module.exports = router;

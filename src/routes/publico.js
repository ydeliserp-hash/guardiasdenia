'use strict';

/**
 * Enlace de datos PÚBLICO y de SOLO LECTURA para integraciones externas.
 *
 * Lo usa la app de turnos de Anestesia para mostrar, junto a su guardia, el
 * residente de guardia de cada día. Devuelve, por mes PUBLICADO, el mapa
 * { "YYYY-MM-DD": ["Nombre", ...] } (hasta 2 residentes por día).
 *
 * Seguridad: protegido por un token compartido (FEED_TOKEN), comparado en
 * tiempo constante. Sin el token configurado o correcto, no expone nada (401).
 * Solo lectura: nunca modifica datos. Solo meses publicados.
 */

const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');

const env = require('../config/env');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const asyncHandler = require('../middleware/asyncHandler');
const { errores } = require('../utils/errors');
const { getPlan, rangoMes } = require('../services/calendar');
const { toISODate } = require('../utils/dates');

const router = express.Router();

const anioMesQuery = z.object({
  anio: z.coerce.number().int().min(2000).max(2100),
  mes: z.coerce.number().int().min(1).max(12),
});

/** Token compartido en cabecera (x-feed-token) o query (?token=), comparado en tiempo constante. */
function tokenValido(req) {
  if (!env.feedToken) return false; // sin token configurado, el enlace queda cerrado
  const dado = String(req.get('x-feed-token') || req.query.token || '');
  const a = Buffer.from(dado);
  const b = Buffer.from(env.feedToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// GET /publico/guardias?anio=&mes=  → { "YYYY-MM-DD": ["Nombre", ...] }  (solo meses publicados)
router.get(
  '/guardias',
  validate(anioMesQuery, 'query'),
  asyncHandler(async (req, res) => {
    if (!tokenValido(req)) throw errores.noAutorizado('Token de acceso inválido.');
    const { anio, mes } = req.query;

    // Solo se expone lo PUBLICADO. Si el mes está en borrador (o no existe), va vacío.
    const plan = await getPlan({ query }, anio, mes);
    res.set('Cache-Control', 'public, max-age=300'); // cache ligera (5 min) para no martillear la BD
    if (!plan || plan.estado !== 'publicado') return res.json({});

    const { inicio, finExclusivo } = rangoMes(anio, mes);
    const { rows } = await query(
      `SELECT s.fecha, u.nombre
         FROM shifts s
         JOIN users u ON u.id = s.user_id
        WHERE s.fecha >= $1 AND s.fecha < $2
        ORDER BY s.fecha, s.slot`,
      [inicio, finExclusivo],
    );

    const out = {};
    for (const r of rows) {
      const f = toISODate(r.fecha);
      if (!out[f]) out[f] = [];
      out[f].push(r.nombre);
    }
    res.json(out);
  }),
);

module.exports = router;

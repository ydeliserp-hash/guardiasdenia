'use strict';

const express = require('express');
const { z } = require('zod');

const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const asyncHandler = require('../middleware/asyncHandler');
const { serializeStats } = require('../utils/serialize');
const { conteoGuardiasMes } = require('../services/calendar');

const router = express.Router();

const statsQuery = z.object({
  anio: z.coerce.number().int().min(2000).max(2100),
  // Mes para el cálculo de guardias_mes (por defecto, junio 2026 del prototipo
  // / mes en curso). Permite pedir el contador del mes que se muestra.
  mes: z.coerce.number().int().min(1).max(12).optional(),
});

// GET /estadisticas?anio=&mes=
// Por residente: { mes, anio, vi, sa, do, flags } con ámbar(=8)/rojo(>8).
// `mes` = guardias del mes (en vivo desde shifts). `anio` = total anual (contador).
router.get(
  '/',
  requireAuth,
  validate(statsQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { anio } = req.query;
    const mes = req.query.mes || (new Date().getUTCMonth() + 1);

    // Usuarios que hacen guardias (los que aparecen en estadísticas).
    const { rows: usuarios } = await query(
      'SELECT id, hace_guardias, aplica_limites FROM users WHERE activo = TRUE AND hace_guardias = TRUE ORDER BY id',
    );
    const { rows: statRows } = await query('SELECT * FROM year_stats WHERE anio = $1', [anio]);
    const statByUser = Object.fromEntries(statRows.map((s) => [s.user_id, s]));
    const conteoMes = await conteoGuardiasMes({ query }, anio, mes);

    const stats = {};
    for (const u of usuarios) {
      stats[u.id] = serializeStats(statByUser[u.id] || null, conteoMes[u.id] || 0, u.aplica_limites);
    }

    res.json({ anio, mes, limite: 8, stats });
  }),
);

module.exports = router;

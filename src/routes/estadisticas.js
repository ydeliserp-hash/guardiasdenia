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
// TODO se deriva en vivo del calendario PUBLICADO: cargar planillas, editar
// guardias o aprobar cambios actualiza las estadísticas automáticamente.
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

    // Contadores anuales derivados de las guardias publicadas del año.
    const { rows: statRows } = await query(
      `SELECT s.user_id,
              count(*)::int AS guardias_anio,
              count(*) FILTER (WHERE EXTRACT(ISODOW FROM s.fecha) = 5)::int AS vi,
              count(*) FILTER (WHERE EXTRACT(ISODOW FROM s.fecha) = 6)::int AS sa,
              count(*) FILTER (WHERE EXTRACT(ISODOW FROM s.fecha) = 7)::int AS do_
         FROM (
           SELECT s2.user_id, s2.fecha FROM shifts s2
             JOIN month_plans p ON p.id = s2.plan_id AND p.estado = 'publicado'
           UNION ALL
           SELECT ge.user_id, ge.fecha FROM guardias_externas ge
         ) s
        WHERE s.fecha >= make_date($1, 1, 1) AND s.fecha < make_date($1 + 1, 1, 1)
        GROUP BY s.user_id`,
      [anio],
    );
    const statByUser = Object.fromEntries(statRows.map((s) => [s.user_id, s]));
    const conteoMes = await conteoGuardiasMes({ query }, anio, mes);
    // las externas del mes también suman en el contador mensual
    const { rows: extMes } = await query(
      `SELECT user_id, count(*)::int AS n FROM guardias_externas
        WHERE fecha >= make_date($1, $2, 1)
          AND fecha < (make_date($1, $2, 1) + INTERVAL '1 month')
        GROUP BY user_id`,
      [anio, mes],
    );
    for (const e of extMes) conteoMes[e.user_id] = (conteoMes[e.user_id] || 0) + e.n;

    const stats = {};
    for (const u of usuarios) {
      stats[u.id] = serializeStats(statByUser[u.id] || null, conteoMes[u.id] || 0, u.aplica_limites);
    }

    res.json({ anio, mes, limite: 8, stats });
  }),
);

module.exports = router;

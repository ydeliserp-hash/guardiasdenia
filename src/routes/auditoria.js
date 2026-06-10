'use strict';

const express = require('express');
const { z } = require('zod');

const { query } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const asyncHandler = require('../middleware/asyncHandler');
const { serializeAudit } = require('../utils/serialize');
const { isValidISODate } = require('../utils/dates');

const router = express.Router();

const ENTIDADES = ['solicitud', 'planilla', 'usuario', 'guardia'];

const filtroSchema = z.object({
  entidad: z.enum(ENTIDADES).optional(),
  entidad_id: z.string().min(1).optional(),
  desde: z.string().refine(isValidISODate, 'Fecha inválida (YYYY-MM-DD).').optional(),
  hasta: z.string().refine(isValidISODate, 'Fecha inválida (YYYY-MM-DD).').optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

// GET /auditoria?entidad=&entidad_id=&desde=&hasta=&limit=  (r4/tutor) — solo lectura.
router.get(
  '/',
  requireAuth,
  requireRole('r4', 'tutor'),
  validate(filtroSchema, 'query'),
  asyncHandler(async (req, res) => {
    const { entidad, entidad_id: entidadId, desde, hasta } = req.query;
    const limit = req.query.limit || 200;

    const cond = [];
    const params = [];
    let i = 1;
    if (entidad) { cond.push(`entidad = $${i++}`); params.push(entidad); }
    if (entidadId) { cond.push(`entidad_id = $${i++}`); params.push(entidadId); }
    if (desde) { cond.push(`creado_en >= $${i++}`); params.push(desde); }
    if (hasta) { cond.push(`creado_en < ($${i++}::date + INTERVAL '1 day')`); params.push(hasta); }

    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    params.push(limit);
    const { rows } = await query(
      `SELECT * FROM audit_log ${where} ORDER BY creado_en DESC LIMIT $${i}`,
      params,
    );
    res.json(rows.map(serializeAudit));
  }),
);

module.exports = router;

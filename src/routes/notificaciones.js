'use strict';

const express = require('express');

const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { errores } = require('../utils/errors');
const { serializeNotification } = require('../utils/serialize');

const router = express.Router();

// GET /notificaciones — del usuario actual (con contador de no leídas).
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY creada_en DESC',
      [req.user.id],
    );
    const now = new Date();
    const items = rows.map((r) => serializeNotification(r, now));
    res.json({ no_leidas: items.filter((n) => !n.leida).length, notificaciones: items });
  }),
);

// POST /notificaciones/marcar-leidas — marca todas como leídas.
router.post(
  '/marcar-leidas',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rowCount } = await query(
      'UPDATE notifications SET leida = TRUE WHERE user_id = $1 AND leida = FALSE',
      [req.user.id],
    );
    res.json({ ok: true, marcadas: rowCount });
  }),
);

// POST /notificaciones/:id/leer — marca una como leída (debe ser del usuario).
router.post(
  '/:id/leer',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      'UPDATE notifications SET leida = TRUE WHERE id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, req.user.id],
    );
    if (!rows[0]) throw errores.noEncontrado('Notificación no encontrada.');
    res.json(serializeNotification(rows[0]));
  }),
);

module.exports = router;

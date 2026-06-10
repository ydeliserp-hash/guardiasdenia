'use strict';

const express = require('express');
const { z } = require('zod');

const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const asyncHandler = require('../middleware/asyncHandler');
const { getVapid, guardarSuscripcion, borrarSuscripcion } = require('../services/push');

const router = express.Router();

const subSchema = z.object({
  endpoint: z.string().url('Endpoint de suscripción inválido.'),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

// GET /push/clave-publica — clave VAPID pública para suscribirse.
router.get(
  '/clave-publica',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const { public_key: publicKey } = await getVapid();
    res.json({ publicKey });
  }),
);

// POST /push/suscribir — registra la suscripción de este dispositivo.
router.post(
  '/suscribir',
  requireAuth,
  validate(subSchema),
  asyncHandler(async (req, res) => {
    await guardarSuscripcion(req.user.id, req.body);
    res.json({ ok: true, mensaje: 'Notificaciones push activadas en este dispositivo.' });
  }),
);

// POST /push/baja — elimina la suscripción de este dispositivo.
router.post(
  '/baja',
  requireAuth,
  validate(z.object({ endpoint: z.string().url() })),
  asyncHandler(async (req, res) => {
    await borrarSuscripcion(req.body.endpoint, req.user.id);
    res.json({ ok: true, mensaje: 'Notificaciones push desactivadas en este dispositivo.' });
  }),
);

module.exports = router;

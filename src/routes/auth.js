'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');

const { query } = require('../config/db');
const { signAccessToken, signTempToken, verifyToken } = require('../utils/jwt');
const { serializeUser } = require('../utils/serialize');
const { errores } = require('../utils/errors');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

const dniSchema = z.string().trim().min(1, 'El DNI es obligatorio.');
const passwordSchema = z.string().min(6, 'La contraseña debe tener al menos 6 caracteres.');

async function findByDni(dni) {
  const { rows } = await query('SELECT * FROM users WHERE dni = $1', [dni]);
  return rows[0] || null;
}

// POST /auth/login  { dni, password } → { token, user }
router.post(
  '/login',
  validate(z.object({ dni: dniSchema, password: z.string().min(1, 'La contraseña es obligatoria.') })),
  asyncHandler(async (req, res) => {
    const { dni, password } = req.body;
    const user = await findByDni(dni);

    if (!user || !user.activo) {
      throw errores.noAutorizado('DNI o contraseña incorrectos.');
    }
    if (user.password_hash == null) {
      throw errores.noAutorizado('Tu cuenta aún no está activada. Usa el primer acceso con tu código de activación.');
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      throw errores.noAutorizado('DNI o contraseña incorrectos.');
    }

    res.json({ token: signAccessToken(user), user: serializeUser(user) });
  }),
);

// POST /auth/primer-acceso  { dni, codigo } → { ok, tempToken }
router.post(
  '/primer-acceso',
  validate(z.object({ dni: dniSchema, codigo: z.string().trim().min(1, 'El código de activación es obligatorio.') })),
  asyncHandler(async (req, res) => {
    const { dni, codigo } = req.body;
    const user = await findByDni(dni);

    // Mensaje genérico para no revelar si el DNI existe.
    const invalido = () => errores.noAutorizado('DNI o código de activación incorrectos.');

    if (!user || !user.activo) throw invalido();
    if (user.password_hash != null) {
      throw errores.conflicto('Esta cuenta ya está activada. Inicia sesión con tu contraseña.');
    }
    if (!user.activation_code || user.activation_code !== codigo) {
      throw invalido();
    }

    res.json({ ok: true, tempToken: signTempToken(user) });
  }),
);

// POST /auth/crear-password  { tempToken, password } → { token, user }
router.post(
  '/crear-password',
  validate(z.object({ tempToken: z.string().min(1, 'Falta el tempToken.'), password: passwordSchema })),
  asyncHandler(async (req, res) => {
    const { tempToken, password } = req.body;

    let payload;
    try {
      payload = verifyToken(tempToken);
    } catch (_err) {
      throw errores.noAutorizado('El token de primer acceso es inválido o ha caducado. Repite el primer acceso.');
    }
    if (payload.scope !== 'primer_acceso') {
      throw errores.noAutorizado('Token no válido para crear la contraseña.');
    }

    const { rows } = await query('SELECT * FROM users WHERE id = $1', [payload.sub]);
    const user = rows[0];
    if (!user || !user.activo) throw errores.noAutorizado('La cuenta no existe o está dada de baja.');
    if (user.password_hash != null) {
      throw errores.conflicto('Esta cuenta ya tiene contraseña. Inicia sesión normalmente.');
    }

    const hash = await bcrypt.hash(password, 10);
    // Consume el código (lo invalida) y guarda el hash, todo de una vez.
    const updated = await query(
      'UPDATE users SET password_hash = $1, activation_code = NULL WHERE id = $2 RETURNING *',
      [hash, user.id],
    );

    const fresh = updated.rows[0];
    res.json({ token: signAccessToken(fresh), user: serializeUser(fresh) });
  }),
);

// GET /auth/me → { user }
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: serializeUser(req.user) });
  }),
);

module.exports = router;

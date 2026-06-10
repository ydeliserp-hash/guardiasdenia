'use strict';

const { verifyToken } = require('../utils/jwt');
const { errores } = require('../utils/errors');
const { query } = require('../config/db');
const asyncHandler = require('./asyncHandler');

/**
 * Exige un token de acceso válido. Carga el usuario completo en req.user.
 * Rechaza tokens de scope distinto a 'acceso' (p.ej. el tempToken).
 */
const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const [tipo, token] = header.split(' ');
  if (tipo !== 'Bearer' || !token) {
    throw errores.noAutorizado('Falta el token de acceso (cabecera Authorization: Bearer ...).');
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch (_err) {
    throw errores.noAutorizado('Token inválido o caducado.');
  }
  if (payload.scope !== 'acceso') {
    throw errores.noAutorizado('Este token no sirve para acceder a la API.');
  }

  const { rows } = await query('SELECT * FROM users WHERE id = $1', [payload.sub]);
  const user = rows[0];
  if (!user || !user.activo) {
    throw errores.noAutorizado('La cuenta no existe o está dada de baja.');
  }

  req.user = user;
  next();
});

/** Restringe el acceso a una lista de roles. Usar después de requireAuth. */
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(errores.noAutorizado());
    }
    if (!roles.includes(req.user.role)) {
      return next(errores.prohibido(`Esta acción requiere uno de los roles: ${roles.join(', ')}.`));
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };

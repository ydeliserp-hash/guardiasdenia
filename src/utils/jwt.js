'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');

/** Token de acceso normal: identifica al usuario y su rol. */
function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, scope: 'acceso' },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn },
  );
}

/** Token temporal del flujo de primer acceso: solo sirve para crear contraseña. */
function signTempToken(user) {
  return jwt.sign(
    { sub: user.id, scope: 'primer_acceso' },
    env.jwtSecret,
    { expiresIn: env.jwtTempExpiresIn },
  );
}

function verifyToken(token) {
  return jwt.verify(token, env.jwtSecret);
}

module.exports = { signAccessToken, signTempToken, verifyToken };

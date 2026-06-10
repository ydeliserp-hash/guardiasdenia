'use strict';

const { ApiError } = require('../utils/errors');

/** Ruta no encontrada → 404 en español. */
function notFound(_req, res) {
  res.status(404).json({
    error: { codigo: 'no_encontrado', mensaje: 'La ruta solicitada no existe.' },
  });
}

/** Manejador de errores global. Devuelve siempre JSON en español. */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: { codigo: err.codigo, mensaje: err.message, detalles: err.detalles || undefined },
    });
  }

  // Violaciones de constraints de PostgreSQL → mensajes claros.
  if (err && err.code) {
    switch (err.code) {
      case '23505': // unique_violation
        return res.status(409).json({
          error: { codigo: 'conflicto', mensaje: 'Ya existe un registro con esos datos únicos (DNI, color o guardia duplicada).' },
        });
      case '23503': // foreign_key_violation
        return res.status(400).json({
          error: { codigo: 'validacion', mensaje: 'Referencia inválida: el usuario o recurso indicado no existe.' },
        });
      case '23514': // check_violation
        return res.status(422).json({
          error: { codigo: 'regla_negocio', mensaje: 'La operación viola una restricción de datos.' },
        });
      default:
        break;
    }
  }

  console.error('Error no controlado:', err);
  res.status(500).json({
    error: { codigo: 'error_interno', mensaje: 'Ha ocurrido un error interno en el servidor.' },
  });
}

module.exports = { notFound, errorHandler };

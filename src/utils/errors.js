'use strict';

/**
 * Error de API con código HTTP y mensaje en español. El manejador de errores
 * global lo traduce a una respuesta JSON `{ error: { mensaje, codigo, detalles } }`.
 */
class ApiError extends Error {
  constructor(statusCode, mensaje, { codigo = null, detalles = null } = {}) {
    super(mensaje);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.codigo = codigo;
    this.detalles = detalles;
  }
}

// Atajos para los códigos más usados, todos con mensaje en español.
const errores = {
  noAutorizado: (msg = 'No autorizado. Inicia sesión.') => new ApiError(401, msg, { codigo: 'no_autorizado' }),
  prohibido: (msg = 'No tienes permiso para realizar esta acción.') => new ApiError(403, msg, { codigo: 'prohibido' }),
  noEncontrado: (msg = 'Recurso no encontrado.') => new ApiError(404, msg, { codigo: 'no_encontrado' }),
  validacion: (msg = 'Datos inválidos.', detalles = null) => new ApiError(400, msg, { codigo: 'validacion', detalles }),
  conflicto: (msg = 'Conflicto con el estado actual.') => new ApiError(409, msg, { codigo: 'conflicto' }),
  reglaNegocio: (msg, detalles = null) => new ApiError(422, msg, { codigo: 'regla_negocio', detalles }),
};

module.exports = { ApiError, errores };

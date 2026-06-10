'use strict';

const { errores } = require('../utils/errors');

/**
 * Valida una parte de la request (body|query|params) con un schema de zod.
 * Si falla, lanza un error 400 con los detalles en español. Si pasa,
 * sustituye req[parte] por los datos ya parseados/transformados.
 */
function validate(schema, parte = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[parte]);
    if (!result.success) {
      const detalles = result.error.issues.map((i) => ({
        campo: i.path.join('.') || '(raíz)',
        mensaje: i.message,
      }));
      return next(errores.validacion('Los datos enviados no son válidos.', detalles));
    }
    req[parte] = result.data;
    next();
  };
}

module.exports = { validate };

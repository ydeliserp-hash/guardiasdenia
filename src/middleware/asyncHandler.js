'use strict';

/** Envuelve un handler async y reenvía cualquier error a next(). */
module.exports = function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

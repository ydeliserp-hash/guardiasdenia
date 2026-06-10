'use strict';

// Punto de entrada serverless para Vercel.
// Una app de Express ES un handler (req, res) => ..., así que la exportamos
// directamente. Vercel reutiliza la instancia "caliente" entre invocaciones,
// de modo que el pool de PostgreSQL se reaprovecha (con PG_POOL_MAX=1).
const { createApp } = require('../src/app');

const app = createApp();

module.exports = app;

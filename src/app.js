'use strict';

const express = require('express');
const cors = require('cors');

const env = require('./config/env');
const { notFound, errorHandler } = require('./middleware/error');

const authRoutes = require('./routes/auth');
const planesRoutes = require('./routes/planes');
const guardiasRoutes = require('./routes/guardias');
const estadisticasRoutes = require('./routes/estadisticas');
const solicitudesRoutes = require('./routes/solicitudes');
const notificacionesRoutes = require('./routes/notificaciones');
const usuariosRoutes = require('./routes/usuarios');
const auditoriaRoutes = require('./routes/auditoria');
const pushRoutes = require('./routes/push');

function createApp() {
  const app = express();

  app.use(cors({
    origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(',').map((s) => s.trim()),
  }));
  app.use(express.json());

  // Portada informativa (la raíz no es parte de la API).
  app.get('/', (_req, res) => res.json({
    servicio: 'API de Guardias de Residentes — Hospital U. de Dénia',
    estado: 'en funcionamiento',
    nota: 'Esto es la API (el motor de datos). La aplicación visual es el frontend, que se conecta a estas rutas.',
    rutas_principales: ['/salud', '/auth/login', '/guardias?anio=&mes=', '/solicitudes', '/notificaciones', '/estadisticas?anio='],
  }));

  // Salud del servicio.
  app.get('/salud', (_req, res) => res.json({ ok: true, servicio: 'guardias-residentes-api', entorno: env.nodeEnv }));

  // Rutas de la API.
  app.use('/auth', authRoutes);
  app.use('/planes', planesRoutes);
  app.use('/guardias', guardiasRoutes);
  app.use('/estadisticas', estadisticasRoutes);
  app.use('/solicitudes', solicitudesRoutes);
  app.use('/notificaciones', notificacionesRoutes);
  app.use('/usuarios', usuariosRoutes);
  app.use('/auditoria', auditoriaRoutes);
  app.use('/push', pushRoutes);

  // 404 + manejador de errores (siempre al final).
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };

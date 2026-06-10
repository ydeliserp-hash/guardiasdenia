'use strict';

const express = require('express');
const { z } = require('zod');

const { query, withTransaction } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const asyncHandler = require('../middleware/asyncHandler');
const { errores } = require('../utils/errors');
const { esAdmin, getPlan, mapaGuardiasMes, rangoMes } = require('../services/calendar');
const { registrarAuditoria } = require('../services/audit');
const { crearNotificacion } = require('../services/notifications');
const { MESES } = require('../utils/dates');

const router = express.Router();

const anioMesQuery = z.object({
  anio: z.coerce.number().int().min(2000).max(2100),
  mes: z.coerce.number().int().min(1).max(12),
});
const anioMesParams = z.object({
  anio: z.coerce.number().int().min(2000).max(2100),
  mes: z.coerce.number().int().min(1).max(12),
});

function planResumen(plan, anio, mes) {
  return {
    anio,
    mes,
    estado: plan ? plan.estado : 'borrador',
    publicado_por: plan ? plan.publicado_por : null,
    publicado_en: plan ? plan.publicado_en : null,
    existe: Boolean(plan),
  };
}

// GET /planes?anio=&mes=  → estado del plan + guardias del mes.
// Los residentes/externos solo ven las guardias si el plan está 'publicado'.
router.get(
  '/',
  requireAuth,
  validate(anioMesQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { anio, mes } = req.query;
    const plan = await getPlan({ query }, anio, mes);
    const resumen = planResumen(plan, anio, mes);

    const puedeVerBorrador = esAdmin(req.user.role);
    const visible = resumen.estado === 'publicado' || puedeVerBorrador;

    const guardias = visible ? await mapaGuardiasMes({ query }, anio, mes) : {};
    res.json({
      ...resumen,
      visible,
      guardias,
      ...(visible ? {} : { mensaje: 'La planilla de este mes aún está en borrador.' }),
    });
  }),
);

// POST /planes/:anio/:mes/publicar  (r4/tutor)  borrador → publicado
router.post(
  '/:anio/:mes/publicar',
  requireAuth,
  requireRole('r4', 'tutor'),
  validate(anioMesParams, 'params'),
  asyncHandler(async (req, res) => {
    const { anio, mes } = req.params;
    const result = await withTransaction(async (client) => {
      const plan = await getPlan(client, anio, mes);
      if (!plan) throw errores.noEncontrado('No existe planilla para ese mes. Asigna guardias primero.');
      if (plan.estado === 'publicado') throw errores.conflicto('La planilla ya está publicada.');

      const { rows } = await client.query(
        `UPDATE month_plans SET estado = 'publicado', publicado_por = $1, publicado_en = now()
           WHERE id = $2 RETURNING *`,
        [req.user.id, plan.id],
      );
      const actualizado = rows[0];

      await registrarAuditoria(client, {
        entidad: 'planilla',
        entidadId: actualizado.id,
        accion: 'publicada',
        actorId: req.user.id,
        estadoAnterior: 'borrador',
        estadoNuevo: 'publicado',
        detalle: { anio, mes },
      });

      // Notifica a todos los residentes con guardias ese mes.
      const { inicio, finExclusivo } = rangoMes(anio, mes);
      const { rows: conGuardia } = await client.query(
        'SELECT DISTINCT user_id FROM shifts WHERE fecha >= $1 AND fecha < $2',
        [inicio, finExclusivo],
      );
      for (const { user_id: uid } of conGuardia) {
        await crearNotificacion(client, {
          userId: uid,
          tipo: 'plan',
          icono: 'cal',
          titulo: `Plan de guardias de ${MESES[mes - 1]} publicado`,
          cuerpo: 'Ya puedes consultar el calendario del mes.',
        });
      }

      return actualizado;
    });

    res.json({ ok: true, plan: planResumen(result, anio, mes) });
  }),
);

// POST /planes/:anio/:mes/borrador  (r4/tutor)  publicado → borrador
router.post(
  '/:anio/:mes/borrador',
  requireAuth,
  requireRole('r4', 'tutor'),
  validate(anioMesParams, 'params'),
  asyncHandler(async (req, res) => {
    const { anio, mes } = req.params;
    const result = await withTransaction(async (client) => {
      const plan = await getPlan(client, anio, mes);
      if (!plan) throw errores.noEncontrado('No existe planilla para ese mes.');
      if (plan.estado === 'borrador') throw errores.conflicto('La planilla ya está en borrador.');

      const { rows } = await client.query(
        `UPDATE month_plans SET estado = 'borrador', publicado_por = NULL, publicado_en = NULL
           WHERE id = $1 RETURNING *`,
        [plan.id],
      );
      await registrarAuditoria(client, {
        entidad: 'planilla',
        entidadId: plan.id,
        accion: 'borrador',
        actorId: req.user.id,
        estadoAnterior: 'publicado',
        estadoNuevo: 'borrador',
        detalle: { anio, mes },
      });
      return rows[0];
    });

    res.json({ ok: true, plan: planResumen(result, anio, mes) });
  }),
);

module.exports = router;

'use strict';

const express = require('express');
const { z } = require('zod');

const { query, withTransaction } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const asyncHandler = require('../middleware/asyncHandler');
const { errores } = require('../utils/errors');
const { esAdmin, getPlan, getOrCreatePlan, mapaGuardiasMes } = require('../services/calendar');
const { registrarAuditoria } = require('../services/audit');
const { isValidISODate, yearOf, monthOf, toISODate } = require('../utils/dates');

const router = express.Router();

const anioMesQuery = z.object({
  anio: z.coerce.number().int().min(2000).max(2100),
  mes: z.coerce.number().int().min(1).max(12),
});

const asignacionBody = z.object({
  // Hasta 2 residentes por día (la regla "máx. 2" la garantiza también la BD).
  user_ids: z.array(z.string().min(1)).max(2, 'Como máximo 2 residentes por día.'),
});

// GET /guardias?anio=&mes=  → { [día]: [userId, ...] }  (forma del prototipo)
router.get(
  '/',
  requireAuth,
  validate(anioMesQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { anio, mes } = req.query;
    const plan = await getPlan({ query }, anio, mes);
    const visible = (plan && plan.estado === 'publicado') || esAdmin(req.user.role);
    const guardias = visible ? await mapaGuardiasMes({ query }, anio, mes) : {};
    res.json(guardias);
  }),
);

// PUT /guardias/:fecha  (r4/tutor)  → asigna hasta 2 residentes a un día.
// NOTA: la edición manual de la planilla NO aplica las reglas duras
// (límites Vi/Sa/Do ni días consecutivos); esas reglas solo rigen los
// cambios/cesiones entre residentes. Sí se respeta el máximo de 2 por día.
router.put(
  '/:fecha',
  requireAuth,
  requireRole('r4', 'tutor'),
  validate(asignacionBody),
  asyncHandler(async (req, res) => {
    const { fecha } = req.params;
    if (!isValidISODate(fecha)) {
      throw errores.validacion('La fecha debe tener formato YYYY-MM-DD y ser válida.');
    }
    const { user_ids: userIds } = req.body;

    // Sin duplicados.
    if (new Set(userIds).size !== userIds.length) {
      throw errores.validacion('No puedes asignar al mismo residente dos veces el mismo día.');
    }

    const resultado = await withTransaction(async (client) => {
      // Valida que los usuarios existan, estén activos y hagan guardias.
      if (userIds.length) {
        const { rows: validos } = await client.query(
          'SELECT id, hace_guardias, activo FROM users WHERE id = ANY($1)',
          [userIds],
        );
        const byId = Object.fromEntries(validos.map((u) => [u.id, u]));
        for (const id of userIds) {
          const u = byId[id];
          if (!u || !u.activo) throw errores.validacion(`El usuario ${id} no existe o está dado de baja.`);
          if (!u.hace_guardias) throw errores.validacion(`El usuario ${id} no hace guardias.`);
        }
      }

      const anio = yearOf(fecha);
      const mes = monthOf(fecha);
      const plan = await getOrCreatePlan(client, anio, mes);

      // Estado anterior (para auditoría).
      const { rows: antesRows } = await client.query(
        'SELECT user_id FROM shifts WHERE fecha = $1 ORDER BY slot',
        [fecha],
      );
      const antes = antesRows.map((r) => r.user_id);

      // Reemplaza la asignación del día.
      await client.query('DELETE FROM shifts WHERE fecha = $1', [fecha]);
      let slot = 1;
      for (const uid of userIds) {
        await client.query(
          'INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ($1, $2, $3, $4)',
          [fecha, uid, plan.id, slot],
        );
        slot += 1;
      }

      await registrarAuditoria(client, {
        entidad: 'guardia',
        entidadId: fecha,
        accion: 'asignacion_guardia',
        actorId: req.user.id,
        detalle: { fecha, antes, despues: userIds, plan_id: plan.id },
      });

      return { fecha: toISODate(fecha), user_ids: userIds, plan_estado: plan.estado };
    });

    res.json({ ok: true, ...resultado });
  }),
);

module.exports = router;

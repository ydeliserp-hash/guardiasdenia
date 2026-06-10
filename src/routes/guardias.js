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
const { isValidISODate, yearOf, monthOf, toISODate, addDays, shortLabel } = require('../utils/dates');

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
// La prohibición de DÍAS CONSECUTIVOS es absoluta y se aplica también aquí:
// ni R4 ni tutor pueden dejar a un residente con guardias en días seguidos
// (cruza meses). Los límites Vi/Sa/Do no bloquean la planilla (solo los
// cambios/cesiones), pero el máximo de 2 por día sí se respeta.
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
      const nombres = {};
      if (userIds.length) {
        const { rows: validos } = await client.query(
          'SELECT id, nombre, hace_guardias, activo FROM users WHERE id = ANY($1)',
          [userIds],
        );
        const byId = Object.fromEntries(validos.map((u) => [u.id, u]));
        for (const id of userIds) {
          const u = byId[id];
          if (!u || !u.activo) throw errores.validacion(`El usuario ${id} no existe o está dado de baja.`);
          if (!u.hace_guardias) throw errores.validacion(`El usuario ${id} no hace guardias.`);
          nombres[id] = u.nombre;
        }
      }

      // REGLA DURA: ningún residente puede quedar con guardia en días
      // consecutivos, tampoco al editar la planilla (cruza meses).
      const diaAnterior = addDays(fecha, -1);
      const diaSiguiente = addDays(fecha, 1);
      for (const uid of userIds) {
        const { rows: vecinos } = await client.query(
          'SELECT fecha FROM shifts WHERE user_id = $1 AND fecha = ANY($2::date[])',
          [uid, [diaAnterior, diaSiguiente]],
        );
        if (vecinos.length) {
          const dias = vecinos.map((v) => shortLabel(toISODate(v.fecha))).join(' y ');
          throw errores.reglaNegocio(
            `No permitido: ${nombres[uid]} quedaría con guardias en días consecutivos `
            + `(${shortLabel(fecha)} junto a ${dias}). La prohibición de días seguidos es absoluta.`,
          );
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

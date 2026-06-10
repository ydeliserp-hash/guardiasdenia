'use strict';

/**
 * Guardias externas (rotatorios fuera del hospital).
 * - SOLO el tutor las apunta y las borra (indicando el residente).
 * - Visibles para todos en la pestaña "Externas" (formato calendario).
 * - Cuentan en estadísticas/límites Vi-Sa-Do y en la regla de días
 *   consecutivos (validada aquí contra planilla + externas).
 */

const express = require('express');
const { z } = require('zod');

const { query, withTransaction } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const asyncHandler = require('../middleware/asyncHandler');
const { errores } = require('../utils/errors');
const { isValidISODate, addDays, shortLabel, toISODate } = require('../utils/dates');
const { registrarAuditoria } = require('../services/audit');
const { rangoMes } = require('../services/calendar');

const router = express.Router();

const mesQuery = z.object({
  anio: z.coerce.number().int().min(2000).max(2100),
  mes: z.coerce.number().int().min(1).max(12),
});

const crearSchema = z.object({
  user_id: z.string().min(1, 'Falta el residente (user_id).'),
  fecha: z.string().refine(isValidISODate, 'Fecha inválida (YYYY-MM-DD).'),
  lugar: z.string().trim().max(80, 'El lugar no puede superar 80 caracteres.').optional(),
});

// GET /guardias-externas?anio=&mes= — todas las del mes (visibles para todos).
router.get(
  '/',
  requireAuth,
  validate(mesQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { anio, mes } = req.query;
    const { inicio, finExclusivo } = rangoMes(anio, mes);
    const { rows } = await query(
      `SELECT id, user_id, fecha, lugar FROM guardias_externas
        WHERE fecha >= $1 AND fecha < $2
        ORDER BY fecha, user_id`,
      [inicio, finExclusivo],
    );
    res.json(rows.map((r) => ({ ...r, fecha: toISODate(r.fecha) })));
  }),
);

// POST /guardias-externas — SOLO el tutor apunta una guardia externa a un residente.
router.post(
  '/',
  requireAuth,
  requireRole('tutor'),
  validate(crearSchema),
  asyncHandler(async (req, res) => {
    const { user_id: userId, fecha } = req.body;
    const lugar = req.body.lugar || null;

    const creada = await withTransaction(async (client) => {
      const { rows: uRows } = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
      const destinatario = uRows[0];
      if (!destinatario || !destinatario.activo) {
        throw errores.validacion('El residente indicado no existe o está dado de baja.');
      }
      if (!destinatario.hace_guardias) {
        throw errores.validacion(`${destinatario.nombre} no hace guardias.`);
      }

      // duplicado exacto
      const { rows: dup } = await client.query(
        'SELECT 1 FROM guardias_externas WHERE user_id = $1 AND fecha = $2',
        [userId, fecha],
      );
      if (dup.length) {
        throw errores.conflicto(`${destinatario.nombre} ya tiene una guardia externa el ${shortLabel(fecha)}.`);
      }

      // REGLA DURA: días consecutivos, contra planilla interna + externas.
      const vecinos = [addDays(fecha, -1), fecha, addDays(fecha, 1)];
      const { rows: ocupados } = await client.query(
        `SELECT fecha FROM shifts WHERE user_id = $1 AND fecha = ANY($2::date[])
         UNION ALL
         SELECT fecha FROM guardias_externas WHERE user_id = $1 AND fecha = ANY($2::date[])`,
        [userId, vecinos],
      );
      const dias = ocupados.map((o) => toISODate(o.fecha));
      if (dias.includes(fecha)) {
        throw errores.conflicto(`${destinatario.nombre} ya tiene una guardia el ${shortLabel(fecha)} en el calendario.`);
      }
      const adyacentes = dias.filter((d) => d !== fecha);
      if (adyacentes.length) {
        throw errores.reglaNegocio(
          `No permitido: ${destinatario.nombre} quedaría con guardias en días consecutivos `
          + `(${shortLabel(fecha)} junto a ${adyacentes.map(shortLabel).join(' y ')}).`,
        );
      }

      const { rows } = await client.query(
        `INSERT INTO guardias_externas (user_id, fecha, lugar)
         VALUES ($1, $2, $3) RETURNING id, user_id, fecha, lugar`,
        [userId, fecha, lugar],
      );

      await registrarAuditoria(client, {
        entidad: 'guardia',
        entidadId: fecha,
        accion: 'asignacion_guardia',
        actorId: req.user.id,
        detalle: { externa: true, para: userId, fecha, lugar },
      });

      return rows[0];
    });

    res.status(201).json({ ...creada, fecha: toISODate(creada.fecha) });
  }),
);

// DELETE /guardias-externas/:id — SOLO el tutor.
router.delete(
  '/:id',
  requireAuth,
  requireRole('tutor'),
  asyncHandler(async (req, res) => {
    const eliminada = await withTransaction(async (client) => {
      const { rows } = await client.query(
        'SELECT * FROM guardias_externas WHERE id = $1 FOR UPDATE',
        [req.params.id],
      );
      const g = rows[0];
      if (!g) throw errores.noEncontrado('Esa guardia externa no existe.');
      await client.query('DELETE FROM guardias_externas WHERE id = $1', [g.id]);
      await registrarAuditoria(client, {
        entidad: 'guardia',
        entidadId: toISODate(g.fecha),
        accion: 'asignacion_guardia',
        actorId: req.user.id,
        detalle: { externa: true, eliminada: true, de: g.user_id, lugar: g.lugar },
      });
      return g;
    });
    res.json({ ok: true, mensaje: `Guardia externa del ${shortLabel(toISODate(eliminada.fecha))} eliminada.` });
  }),
);

module.exports = router;

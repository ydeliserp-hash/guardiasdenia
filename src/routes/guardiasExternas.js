'use strict';

/**
 * Guardias externas (rotatorios fuera del hospital).
 * - Cada residente apunta y borra LAS SUYAS (staff puede borrar cualquiera).
 * - Visibles para todos en la pestaña "Externas".
 * - Cuentan en estadísticas/límites Vi-Sa-Do y en la regla de días
 *   consecutivos (validada aquí contra planilla + externas).
 */

const express = require('express');
const { z } = require('zod');

const { query, withTransaction } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
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

// POST /guardias-externas — el usuario actual apunta UNA guardia externa suya.
router.post(
  '/',
  requireAuth,
  validate(crearSchema),
  asyncHandler(async (req, res) => {
    if (!req.user.hace_guardias) {
      throw errores.prohibido('Tu perfil no hace guardias.');
    }
    const { fecha } = req.body;
    const lugar = req.body.lugar || null;

    const creada = await withTransaction(async (client) => {
      // duplicado exacto
      const { rows: dup } = await client.query(
        'SELECT 1 FROM guardias_externas WHERE user_id = $1 AND fecha = $2',
        [req.user.id, fecha],
      );
      if (dup.length) throw errores.conflicto(`Ya tienes apuntada una guardia externa el ${shortLabel(fecha)}.`);

      // REGLA DURA: días consecutivos, contra planilla interna + externas.
      const vecinos = [addDays(fecha, -1), fecha, addDays(fecha, 1)];
      const { rows: ocupados } = await client.query(
        `SELECT fecha FROM shifts WHERE user_id = $1 AND fecha = ANY($2::date[])
         UNION ALL
         SELECT fecha FROM guardias_externas WHERE user_id = $1 AND fecha = ANY($2::date[])`,
        [req.user.id, vecinos],
      );
      const dias = ocupados.map((o) => toISODate(o.fecha));
      if (dias.includes(fecha)) {
        throw errores.conflicto(`Ya tienes una guardia el ${shortLabel(fecha)} en el calendario.`);
      }
      const adyacentes = dias.filter((d) => d !== fecha);
      if (adyacentes.length) {
        throw errores.reglaNegocio(
          `No permitido: quedarías con guardias en días consecutivos `
          + `(${shortLabel(fecha)} junto a ${adyacentes.map(shortLabel).join(' y ')}).`,
        );
      }

      const { rows } = await client.query(
        `INSERT INTO guardias_externas (user_id, fecha, lugar)
         VALUES ($1, $2, $3) RETURNING id, user_id, fecha, lugar`,
        [req.user.id, fecha, lugar],
      );

      await registrarAuditoria(client, {
        entidad: 'guardia',
        entidadId: fecha,
        accion: 'asignacion_guardia',
        actorId: req.user.id,
        detalle: { externa: true, fecha, lugar },
      });

      return rows[0];
    });

    res.status(201).json({ ...creada, fecha: toISODate(creada.fecha) });
  }),
);

// DELETE /guardias-externas/:id — el dueño o staff.
router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const esStaff = ['r4', 'tutor'].includes(req.user.role);
    const eliminada = await withTransaction(async (client) => {
      const { rows } = await client.query(
        'SELECT * FROM guardias_externas WHERE id = $1 FOR UPDATE',
        [req.params.id],
      );
      const g = rows[0];
      if (!g) throw errores.noEncontrado('Esa guardia externa no existe.');
      if (g.user_id !== req.user.id && !esStaff) {
        throw errores.prohibido('Solo puedes borrar tus propias guardias externas.');
      }
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

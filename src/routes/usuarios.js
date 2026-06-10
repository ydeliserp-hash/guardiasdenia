'use strict';

const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');

const { query, withTransaction } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const asyncHandler = require('../middleware/asyncHandler');
const { errores } = require('../utils/errors');
const { serializeUser } = require('../utils/serialize');
const { registrarAuditoria } = require('../services/audit');

const router = express.Router();

const COLORES = ['rosa', 'melocoton', 'amarillo', 'menta', 'salvia', 'cielo', 'bebe', 'lavanda', 'lila', 'coral'];
const ROLES = ['tutor', 'r4', 'residente', 'externo'];

const altaSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.'),
  trato: z.string().trim().min(1).optional(),
  dni: z.string().trim().min(1, 'El DNI es obligatorio.'),
  role: z.enum(ROLES),
  anio: z.string().trim().min(1, 'El año/etiqueta de residencia es obligatorio.'),
  color: z.enum(COLORES, { errorMap: () => ({ message: `Color inválido. Debe ser uno de: ${COLORES.join(', ')}.` }) }),
  aplica_limites: z.boolean().optional(),
  hace_guardias: z.boolean().optional(),
});

const editarSchema = z.object({
  nombre: z.string().trim().min(1).optional(),
  trato: z.string().trim().min(1).optional(),
  anio: z.string().trim().min(1).optional(),
  role: z.enum(ROLES).optional(),
  color: z.enum(COLORES).optional(),
  aplica_limites: z.boolean().optional(),
  hace_guardias: z.boolean().optional(),
  activo: z.boolean().optional(),
}).refine((obj) => Object.keys(obj).length > 0, { message: 'No hay nada que actualizar.' });

/** Iniciales (2 letras) a partir del nombre: "Carmen Bisbal" → "CB". */
function derivarIniciales(nombre) {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  const primera = partes[0] || '';
  const segunda = partes[1] || '';
  const ini = segunda ? primera[0] + segunda[0] : primera.slice(0, 2);
  return ini.toUpperCase().slice(0, 2);
}

/** Código de activación legible, de un solo uso y sin caducidad. */
function generarCodigo() {
  return crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 8); // p.ej. "A1B2C3D4"
}

async function colorOcupado(db, color, excluirId = null) {
  const { rows } = await db.query(
    'SELECT id FROM users WHERE color = $1 AND activo = TRUE AND ($2::text IS NULL OR id <> $2)',
    [color, excluirId],
  );
  return rows.length > 0;
}

// GET /usuarios — lista (r4/tutor). Incluye activos e inactivos.
router.get(
  '/',
  requireAuth,
  requireRole('r4', 'tutor'),
  asyncHandler(async (_req, res) => {
    const { rows } = await query('SELECT * FROM users ORDER BY activo DESC, nombre ASC');
    res.json(rows.map((u) => serializeUser(u)));
  }),
);

// POST /usuarios — alta (r4/tutor). Genera código de activación sin caducidad.
router.post(
  '/',
  requireAuth,
  requireRole('r4', 'tutor'),
  validate(altaSchema),
  asyncHandler(async (req, res) => {
    const { nombre, dni, role, anio, color } = req.body;
    const trato = req.body.trato || nombre;
    const iniciales = derivarIniciales(nombre);
    // El tutor no hace guardias; el resto sí por defecto.
    const haceGuardias = req.body.hace_guardias ?? (role !== 'tutor');
    // Por defecto aplica límites, salvo que se indique lo contrario (externos).
    const aplicaLimites = req.body.aplica_limites ?? true;
    const codigo = generarCodigo();

    const creado = await withTransaction(async (client) => {
      if (await colorOcupado(client, color)) {
        throw errores.conflicto(`El color "${color}" ya está en uso por otro usuario activo.`);
      }
      const { rows: dniRows } = await client.query('SELECT 1 FROM users WHERE dni = $1', [dni]);
      if (dniRows.length) throw errores.conflicto('Ya existe un usuario con ese DNI.');

      const { rows } = await client.query(
        `INSERT INTO users
           (nombre, trato, iniciales, dni, role, anio, color, hace_guardias, aplica_limites, activation_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [nombre, trato, iniciales, dni, role, anio, color, haceGuardias, aplicaLimites, codigo],
      );
      const user = rows[0];

      await registrarAuditoria(client, {
        entidad: 'usuario',
        entidadId: user.id,
        accion: 'alta_usuario',
        actorId: req.user.id,
        estadoNuevo: 'activo',
        detalle: { nombre, dni, role, anio, color, hace_guardias: haceGuardias, aplica_limites: aplicaLimites },
      });

      return user;
    });

    // Devuelve el código de activación para entregárselo al nuevo usuario.
    res.status(201).json(serializeUser(creado, { incluirCodigo: true }));
  }),
);

// PATCH /usuarios/:id — editar (r4/tutor). Incluye toggle aplica_limites.
router.patch(
  '/:id',
  requireAuth,
  requireRole('r4', 'tutor'),
  validate(editarSchema),
  asyncHandler(async (req, res) => {
    const cambios = req.body;

    const actualizado = await withTransaction(async (client) => {
      const { rows: prevRows } = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [req.params.id]);
      const prev = prevRows[0];
      if (!prev) throw errores.noEncontrado('Usuario no encontrado.');

      if (cambios.color && cambios.color !== prev.color) {
        if (await colorOcupado(client, cambios.color, prev.id)) {
          throw errores.conflicto(`El color "${cambios.color}" ya está en uso por otro usuario activo.`);
        }
      }

      // Construye el SET dinámico solo con los campos enviados.
      const campos = { ...cambios };
      if (cambios.nombre && !cambios.iniciales) {
        campos.iniciales = derivarIniciales(cambios.nombre);
      }
      const cols = Object.keys(campos);
      const sets = cols.map((c, i) => `${c} = $${i + 2}`);
      const valores = cols.map((c) => campos[c]);

      const { rows } = await client.query(
        `UPDATE users SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
        [prev.id, ...valores],
      );
      const user = rows[0];

      // Si cambió 'activo', registra alta/baja; si no, edición genérica.
      let accion = 'editado_usuario';
      let estadoAnterior = null;
      let estadoNuevo = null;
      if ('activo' in cambios && cambios.activo !== prev.activo) {
        accion = cambios.activo ? 'alta_usuario' : 'baja_usuario';
        estadoAnterior = prev.activo ? 'activo' : 'inactivo';
        estadoNuevo = cambios.activo ? 'activo' : 'inactivo';
      }

      await registrarAuditoria(client, {
        entidad: 'usuario',
        entidadId: user.id,
        accion,
        actorId: req.user.id,
        estadoAnterior,
        estadoNuevo,
        detalle: { cambios },
      });

      return user;
    });

    res.json(serializeUser(actualizado));
  }),
);

// DELETE /usuarios/:id — baja lógica (libera el color).
router.delete(
  '/:id',
  requireAuth,
  requireRole('r4', 'tutor'),
  asyncHandler(async (req, res) => {
    const out = await withTransaction(async (client) => {
      const { rows: prevRows } = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [req.params.id]);
      const prev = prevRows[0];
      if (!prev) throw errores.noEncontrado('Usuario no encontrado.');
      if (!prev.activo) throw errores.conflicto('El usuario ya está dado de baja.');

      const { rows } = await client.query(
        'UPDATE users SET activo = FALSE WHERE id = $1 RETURNING *',
        [prev.id],
      );

      await registrarAuditoria(client, {
        entidad: 'usuario',
        entidadId: prev.id,
        accion: 'baja_usuario',
        actorId: req.user.id,
        estadoAnterior: 'activo',
        estadoNuevo: 'inactivo',
        detalle: { color_liberado: prev.color },
      });

      return rows[0];
    });

    res.json({ ok: true, usuario: serializeUser(out) });
  }),
);

module.exports = router;

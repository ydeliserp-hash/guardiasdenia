'use strict';

const express = require('express');
const { z } = require('zod');

const { query, withTransaction } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const asyncHandler = require('../middleware/asyncHandler');
const { errores } = require('../utils/errors');
const { isValidISODate, shortLabel, toISODate } = require('../utils/dates');
const { serializeRequest, serializeAudit } = require('../utils/serialize');
const { registrarAuditoria } = require('../services/audit');
const { crearNotificacion, notificarTutores } = require('../services/notifications');
const { enviarPush, enviarPushTutores } = require('../services/push');
const {
  prepararCreacion, ejecutarCambio, validarReglas, getUser,
} = require('../services/changeRequests');

const router = express.Router();

const isoDate = z.string().refine(isValidISODate, 'Fecha inválida (formato YYYY-MM-DD).');

const crearSchema = z.object({
  tipo: z.enum(['intercambio', 'cesion']),
  a_user_id: z.string().min(1, 'Falta el compañero destino (a_user_id).'),
  guardia_de: isoDate,
  guardia_a: isoDate.optional().nullable(),
  nota: z.string().max(240, 'La nota no puede superar los 240 caracteres.').optional(),
});

const motivoSchema = z.object({ motivo: z.string().max(500).optional() }).partial();
const aprobarSchema = z.object({ confirmar: z.boolean().optional() }).partial();

// Carga la solicitud con bloqueo de fila (FOR UPDATE) dentro de una transacción.
async function getRequestForUpdate(client, id) {
  const { rows } = await client.query('SELECT * FROM change_requests WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) throw errores.noEncontrado('La solicitud no existe.');
  return rows[0];
}

/** Recalcula flag_exceso (y aplica el bloqueo de consecutivos) con el estado actual. */
async function recomputarFlag(client, request) {
  const deUser = await getUser(client, request.de_user_id);
  const aUser = await getUser(client, request.a_user_id);
  return validarReglas(client, {
    tipo: request.tipo,
    deUser,
    aUser,
    guardiaDe: toISODate(request.guardia_de),
    guardiaA: request.guardia_a ? toISODate(request.guardia_a) : null,
  });
}

// ---------------------------------------------------------------------------
// GET /solicitudes  — solo en las que participa el usuario; el tutor ve además
// todas las que están pend_tutor (su cola de aprobación).
// ---------------------------------------------------------------------------
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const u = req.user;
    let rows;
    if (u.role === 'tutor') {
      ({ rows } = await query(
        `SELECT * FROM change_requests
           WHERE de_user_id = $1 OR a_user_id = $1 OR estado = 'pend_tutor'
           ORDER BY creada_en DESC`,
        [u.id],
      ));
    } else {
      ({ rows } = await query(
        `SELECT * FROM change_requests
           WHERE de_user_id = $1 OR a_user_id = $1
           ORDER BY creada_en DESC`,
        [u.id],
      ));
    }
    const now = new Date();
    res.json(rows.map((r) => serializeRequest(r, now)));
  }),
);

// ---------------------------------------------------------------------------
// POST /solicitudes  — crear (residente/externo/r4; el tutor NO crea).
// ---------------------------------------------------------------------------
router.post(
  '/',
  requireAuth,
  requireRole('residente', 'externo', 'r4'),
  validate(crearSchema),
  asyncHandler(async (req, res) => {
    const { tipo, a_user_id: aUserId, guardia_de: guardiaDe, nota } = req.body;
    const guardiaA = tipo === 'intercambio' ? (req.body.guardia_a || null) : null;

    const creada = await withTransaction(async (client) => {
      const { aUser, flag } = await prepararCreacion(client, {
        tipo,
        solicitante: req.user,
        aUserId,
        guardiaDe,
        guardiaA,
      });

      const { rows } = await client.query(
        `INSERT INTO change_requests
           (tipo, de_user_id, a_user_id, guardia_de, guardia_a, estado, flag_exceso, nota)
         VALUES ($1, $2, $3, $4, $5, 'pend_companero', $6, $7)
         RETURNING *`,
        [tipo, req.user.id, aUserId, guardiaDe, guardiaA, flag ? JSON.stringify(flag) : null, nota || null],
      );
      const request = rows[0];

      await registrarAuditoria(client, {
        entidad: 'solicitud',
        entidadId: request.id,
        accion: 'creada',
        actorId: req.user.id,
        estadoNuevo: 'pend_companero',
        detalle: {
          tipo, de: req.user.id, a: aUserId, guardia_de: guardiaDe, guardia_a: guardiaA, flag_exceso: flag,
        },
      });

      // Notifica al compañero destino.
      const esIntercambio = tipo === 'intercambio';
      await crearNotificacion(client, {
        userId: aUser.id,
        tipo: 'solicitud',
        icono: esIntercambio ? 'swap' : 'clock',
        titulo: `${req.user.nombre} te propone ${esIntercambio ? 'un intercambio' : 'una cesión'}`,
        cuerpo: esIntercambio
          ? `Su guardia del ${shortLabel(guardiaDe)} por la tuya del ${shortLabel(guardiaA)}.`
          : `Te cede la guardia del ${shortLabel(guardiaDe)}.`,
        refRequestId: request.id,
      });

      // El tutor se entera de TODA solicitud desde el primer momento.
      await notificarTutores(client, {
        titulo: `Nueva solicitud: ${esIntercambio ? 'intercambio' : 'cesión'} entre residentes`,
        cuerpo: esIntercambio
          ? `${req.user.nombre} propone a ${aUser.nombre} cambiar ${shortLabel(guardiaDe)} por ${shortLabel(guardiaA)}.`
          : `${req.user.nombre} cede a ${aUser.nombre} la guardia del ${shortLabel(guardiaDe)}.`,
        refRequestId: request.id,
      });

      return { request, aUserNombre: aUser.nombre };
    });

    // Push (fuera de la transacción; nunca bloquea): al destino y a los tutores.
    await enviarPush(aUserId, {
      titulo: `${req.user.nombre} te propone ${tipo === 'intercambio' ? 'un intercambio' : 'una cesión'}`,
      cuerpo: tipo === 'intercambio'
        ? `Su guardia del ${shortLabel(guardiaDe)} por la tuya del ${shortLabel(guardiaA)}.`
        : `Te cede la guardia del ${shortLabel(guardiaDe)}.`,
      url: '/',
    });
    await enviarPushTutores({
      titulo: `Nueva solicitud: ${tipo === 'intercambio' ? 'intercambio' : 'cesión'} entre residentes`,
      cuerpo: tipo === 'intercambio'
        ? `${req.user.nombre} propone a ${creada.aUserNombre} cambiar ${shortLabel(guardiaDe)} por ${shortLabel(guardiaA)}.`
        : `${req.user.nombre} cede a ${creada.aUserNombre} la guardia del ${shortLabel(guardiaDe)}.`,
      url: '/',
    });

    res.status(201).json(serializeRequest(creada.request));
  }),
);

// ---------------------------------------------------------------------------
// POST /solicitudes/:id/aceptar  — solo el compañero destino; pend_companero → pend_tutor
// ---------------------------------------------------------------------------
router.post(
  '/:id/aceptar',
  requireAuth,
  asyncHandler(async (req, res) => {
    const out = await withTransaction(async (client) => {
      const request = await getRequestForUpdate(client, req.params.id);
      if (request.a_user_id !== req.user.id) {
        throw errores.prohibido('Solo el compañero destino puede aceptar esta solicitud.');
      }
      if (request.estado !== 'pend_companero') {
        throw errores.conflicto(`La solicitud no está pendiente del compañero (estado actual: ${request.estado}).`);
      }

      // Re-valida reglas (bloqueo de consecutivos) y refresca flag_exceso.
      const flag = await recomputarFlag(client, request);

      const { rows } = await client.query(
        `UPDATE change_requests SET estado = 'pend_tutor', flag_exceso = $2, updated_at = now()
           WHERE id = $1 RETURNING *`,
        [request.id, flag ? JSON.stringify(flag) : null],
      );
      const actualizado = rows[0];

      await registrarAuditoria(client, {
        entidad: 'solicitud',
        entidadId: request.id,
        accion: 'aceptada',
        actorId: req.user.id,
        estadoAnterior: 'pend_companero',
        estadoNuevo: 'pend_tutor',
        detalle: { aceptado_por: req.user.id, flag_exceso: flag },
      });

      // Avisa al solicitante y encola al/los tutor(es).
      await crearNotificacion(client, {
        userId: request.de_user_id,
        tipo: 'estado',
        icono: 'clock',
        titulo: `${req.user.nombre} aceptó tu solicitud`,
        cuerpo: 'Queda pendiente de la aprobación del tutor.',
        refRequestId: request.id,
      });
      await notificarTutores(client, {
        titulo: 'Solicitud pendiente de aprobación',
        cuerpo: flag
          ? `Cambio con EXCESO de ${flag.tipo} (${flag.actual}→${flag.nuevo}). Requiere doble confirmación.`
          : 'Hay un cambio aceptado por el compañero, pendiente de tu aprobación.',
        refRequestId: request.id,
      });

      return actualizado;
    });

    // Push al solicitante y a los tutores (cola de aprobación).
    await enviarPush(out.de_user_id, {
      titulo: `${req.user.nombre} aceptó tu solicitud`,
      cuerpo: 'Queda pendiente de la aprobación del tutor.',
      url: '/',
    });
    await enviarPushTutores({
      titulo: 'Solicitud pendiente de aprobación',
      cuerpo: 'Hay un cambio aceptado por el compañero, pendiente de tu aprobación.',
      url: '/',
    });

    res.json(serializeRequest(out));
  }),
);

// ---------------------------------------------------------------------------
// POST /solicitudes/:id/rechazar  — destino (pend_companero) o tutor (pend_tutor)
// ---------------------------------------------------------------------------
router.post(
  '/:id/rechazar',
  requireAuth,
  validate(motivoSchema),
  asyncHandler(async (req, res) => {
    const motivo = req.body.motivo || null;
    const out = await withTransaction(async (client) => {
      const request = await getRequestForUpdate(client, req.params.id);

      const esDestino = request.a_user_id === req.user.id && request.estado === 'pend_companero';
      const esTutor = req.user.role === 'tutor' && request.estado === 'pend_tutor';
      if (!esDestino && !esTutor) {
        if (request.estado === 'pend_companero') {
          throw errores.prohibido('Solo el compañero destino puede rechazar en esta fase.');
        }
        if (request.estado === 'pend_tutor') {
          throw errores.prohibido('En esta fase solo el tutor puede rechazar la solicitud.');
        }
        throw errores.conflicto(`La solicitud ya está ${request.estado} y no puede rechazarse.`);
      }

      const { rows } = await client.query(
        `UPDATE change_requests SET estado = 'rechazada', motivo = $2, updated_at = now()
           WHERE id = $1 RETURNING *`,
        [request.id, motivo],
      );

      await registrarAuditoria(client, {
        entidad: 'solicitud',
        entidadId: request.id,
        accion: 'rechazada',
        actorId: req.user.id,
        estadoAnterior: request.estado,
        estadoNuevo: 'rechazada',
        detalle: { rechazado_por: req.user.id, rol: req.user.role, motivo },
      });

      await crearNotificacion(client, {
        userId: request.de_user_id,
        tipo: 'estado',
        icono: 'clock',
        titulo: 'Tu solicitud ha sido rechazada',
        cuerpo: motivo ? `Motivo: ${motivo}` : (esTutor ? 'Rechazada por el tutor.' : 'Rechazada por el compañero.'),
        refRequestId: request.id,
      });

      return rows[0];
    });

    // Push al solicitante con el rechazo.
    await enviarPush(out.de_user_id, {
      titulo: 'Tu solicitud ha sido rechazada',
      cuerpo: out.motivo ? `Motivo: ${out.motivo}` : 'Solicitud rechazada.',
      url: '/',
    });

    res.json(serializeRequest(out));
  }),
);

// ---------------------------------------------------------------------------
// POST /solicitudes/:id/aprobar  — SOLO el tutor; pend_tutor → aprobada.
// Ejecuta el cambio y, si hay flag_exceso, exige { confirmar: true }.
// ---------------------------------------------------------------------------
router.post(
  '/:id/aprobar',
  requireAuth,
  requireRole('tutor'),
  validate(aprobarSchema),
  asyncHandler(async (req, res) => {
    const confirmar = req.body.confirmar === true;

    const out = await withTransaction(async (client) => {
      const request = await getRequestForUpdate(client, req.params.id);
      if (request.estado !== 'pend_tutor') {
        throw errores.conflicto(`Solo se aprueban solicitudes pendientes del tutor (estado actual: ${request.estado}).`);
      }

      // Re-valida, aplica el cambio sobre las guardias reales y ajusta contadores.
      const flag = await ejecutarCambio(client, request, { confirmar });

      const { rows } = await client.query(
        `UPDATE change_requests SET estado = 'aprobada', flag_exceso = $2, updated_at = now()
           WHERE id = $1 RETURNING *`,
        [request.id, flag ? JSON.stringify(flag) : null],
      );
      const actualizado = rows[0];

      // Auditoría rica: reconstruye el histórico completo del cambio aprobado.
      await registrarAuditoria(client, {
        entidad: 'solicitud',
        entidadId: request.id,
        accion: 'aprobada',
        actorId: req.user.id,
        estadoAnterior: 'pend_tutor',
        estadoNuevo: 'aprobada',
        detalle: {
          tipo: request.tipo,
          solicitante: request.de_user_id,
          companero: request.a_user_id,
          tutor: req.user.id,
          guardia_de: toISODate(request.guardia_de),
          guardia_a: request.guardia_a ? toISODate(request.guardia_a) : null,
          flag_exceso: flag,
          forzado_pese_a_exceso: Boolean(flag && confirmar),
        },
      });

      // Notifica a ambas partes.
      for (const uid of [request.de_user_id, request.a_user_id]) {
        await crearNotificacion(client, {
          userId: uid,
          tipo: 'aprobada',
          icono: 'check',
          titulo: 'Cambio aprobado por la tutora',
          cuerpo: `El ${request.tipo === 'intercambio' ? 'intercambio' : 'la cesión'} ha sido aprobado y ya está aplicado en el calendario.`,
          refRequestId: request.id,
        });
      }

      return actualizado;
    });

    // Push a ambas partes: el cambio ya está aplicado en el calendario.
    for (const uid of [out.de_user_id, out.a_user_id]) {
      await enviarPush(uid, {
        titulo: 'Cambio aprobado por la tutora',
        cuerpo: 'El cambio ha sido aprobado y ya está aplicado en el calendario.',
        url: '/',
      });
    }

    res.json(serializeRequest(out));
  }),
);

// ---------------------------------------------------------------------------
// POST /solicitudes/:id/cancelar  — solo el solicitante; mientras esté pendiente.
// ---------------------------------------------------------------------------
router.post(
  '/:id/cancelar',
  requireAuth,
  asyncHandler(async (req, res) => {
    const out = await withTransaction(async (client) => {
      const request = await getRequestForUpdate(client, req.params.id);
      if (request.de_user_id !== req.user.id) {
        throw errores.prohibido('Solo quien creó la solicitud puede cancelarla.');
      }
      if (!['pend_companero', 'pend_tutor'].includes(request.estado)) {
        throw errores.conflicto(`La solicitud ya está ${request.estado} y no puede cancelarse.`);
      }

      const { rows } = await client.query(
        `UPDATE change_requests SET estado = 'cancelada', updated_at = now()
           WHERE id = $1 RETURNING *`,
        [request.id],
      );

      await registrarAuditoria(client, {
        entidad: 'solicitud',
        entidadId: request.id,
        accion: 'cancelada',
        actorId: req.user.id,
        estadoAnterior: request.estado,
        estadoNuevo: 'cancelada',
      });

      await crearNotificacion(client, {
        userId: request.a_user_id,
        tipo: 'estado',
        icono: 'clock',
        titulo: 'Solicitud cancelada',
        cuerpo: `${req.user.nombre} ha cancelado la solicitud.`,
        refRequestId: request.id,
      });

      return rows[0];
    });

    // Push al compañero destino: la solicitud quedó cancelada.
    await enviarPush(out.a_user_id, {
      titulo: 'Solicitud cancelada',
      cuerpo: `${req.user.nombre} ha cancelado la solicitud.`,
      url: '/',
    });

    res.json(serializeRequest(out));
  }),
);

// ---------------------------------------------------------------------------
// GET /solicitudes/:id/historial — línea de tiempo (auditoría) de una solicitud.
// Accesible a los participantes y a r4/tutor.
// ---------------------------------------------------------------------------
router.get(
  '/:id/historial',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows: reqRows } = await query('SELECT * FROM change_requests WHERE id = $1', [req.params.id]);
    const request = reqRows[0];
    if (!request) throw errores.noEncontrado('La solicitud no existe.');

    const participa = [request.de_user_id, request.a_user_id].includes(req.user.id);
    const esAdmin = ['r4', 'tutor'].includes(req.user.role);
    if (!participa && !esAdmin) {
      throw errores.prohibido('No participas en esta solicitud.');
    }

    const { rows } = await query(
      `SELECT * FROM audit_log
         WHERE entidad = 'solicitud' AND entidad_id = $1
         ORDER BY creado_en ASC`,
      [req.params.id],
    );
    res.json({
      solicitud: serializeRequest(request),
      historial: rows.map(serializeAudit),
    });
  }),
);

module.exports = router;

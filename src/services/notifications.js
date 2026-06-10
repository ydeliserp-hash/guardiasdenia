'use strict';

/**
 * Servicio de notificaciones. Las notificaciones se generan automáticamente
 * en el backend como efecto de las acciones de negocio. Se crean dentro de la
 * misma transacción que la acción que las dispara.
 */

/** Inserta una notificación para un usuario. */
async function crearNotificacion(client, {
  userId,
  tipo,
  icono,
  titulo,
  cuerpo,
  refRequestId = null,
}) {
  const { rows } = await client.query(
    `INSERT INTO notifications (user_id, tipo, icono, titulo, cuerpo, ref_request_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [userId, tipo, icono, titulo, cuerpo, refRequestId],
  );
  return rows[0];
}

/** Notifica a TODOS los tutores activos (cola de aprobación del tutor). */
async function notificarTutores(client, { titulo, cuerpo, refRequestId = null, excluir = [] }) {
  const { rows } = await client.query(
    "SELECT id FROM users WHERE role = 'tutor' AND activo = TRUE",
  );
  const destinatarios = rows.map((r) => r.id).filter((id) => !excluir.includes(id));
  for (const userId of destinatarios) {
    await crearNotificacion(client, {
      userId,
      tipo: 'solicitud',
      icono: 'clock',
      titulo,
      cuerpo,
      refRequestId,
    });
  }
  return destinatarios.length;
}

module.exports = { crearNotificacion, notificarTutores };

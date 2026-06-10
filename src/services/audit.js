'use strict';

/**
 * Servicio de auditoría. SIEMPRE se invoca con el `client` de una transacción
 * en curso, de modo que la entrada de AuditLog y el cambio que la origina se
 * confirman (COMMIT) juntos o se deshacen (ROLLBACK) juntos.
 *
 * El histórico es inmutable (un trigger de BD impide UPDATE/DELETE).
 */
async function registrarAuditoria(client, {
  entidad,
  entidadId,
  accion,
  actorId = null,
  estadoAnterior = null,
  estadoNuevo = null,
  detalle = null,
}) {
  const { rows } = await client.query(
    `INSERT INTO audit_log
       (entidad, entidad_id, accion, actor_id, estado_anterior, estado_nuevo, detalle)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      entidad,
      String(entidadId),
      accion,
      actorId,
      estadoAnterior,
      estadoNuevo,
      detalle ? JSON.stringify(detalle) : null,
    ],
  );
  return rows[0];
}

module.exports = { registrarAuditoria };

'use strict';

/**
 * Lógica de negocio de las solicitudes de cambio/cesión. Aquí viven las dos
 * REGLAS DURAS y la ejecución del intercambio/cesión sobre las guardias reales.
 *
 * Convenio de "movimientos": para cada usuario implicado calculamos qué guardia
 * ENTREGA y cuál RECIBE.
 *   - cesión:      de_user entrega guardia_de;  a_user recibe guardia_de.
 *   - intercambio: de_user entrega guardia_de y recibe guardia_a;
 *                  a_user  entrega guardia_a  y recibe guardia_de.
 *
 * Reglas (se aplican SOLO a cambios/cesiones, no a la edición manual de la
 * planilla, y se re-evalúan en cada transición):
 *   1) Límites Vi/Sa/Do anuales (8 por tipo). =8 → ámbar; >8 → flag_exceso +
 *      aprobación exclusiva del tutor con doble confirmación. Se evalúa a AMBOS
 *      receptores de un intercambio; se guarda el peor caso en flag_exceso.
 *   2) Días consecutivos: BLOQUEO ABSOLUTO (HTTP 422), cruzando meses.
 */

const { errores } = require('../utils/errors');
const {
  weekendKey, yearOf, addDays, toISODate, shortLabel, WEEKEND_LABEL,
} = require('../utils/dates');

const COL = { vi: 'vi', sa: 'sa', do: 'do_' }; // mapeo clave → columna

// ---------------------------------------------------------------------------
// Contadores anuales (year_stats)
// ---------------------------------------------------------------------------

async function getYearStat(client, userId, anio) {
  const { rows } = await client.query(
    'SELECT * FROM year_stats WHERE user_id = $1 AND anio = $2',
    [userId, anio],
  );
  return rows[0] || null;
}

/**
 * Aplica deltas (pueden ser negativos) a los contadores de un usuario/año.
 * Crea la fila si no existe y nunca baja de 0.
 */
async function aplicarDeltaContador(client, userId, anio, { guardiasAnio = 0, vi = 0, sa = 0, do: doDelta = 0 }) {
  await client.query(
    'INSERT INTO year_stats (user_id, anio) VALUES ($1, $2) ON CONFLICT (user_id, anio) DO NOTHING',
    [userId, anio],
  );
  await client.query(
    `UPDATE year_stats SET
       guardias_anio = GREATEST(guardias_anio + $3, 0),
       vi            = GREATEST(vi + $4, 0),
       sa            = GREATEST(sa + $5, 0),
       do_           = GREATEST(do_ + $6, 0)
     WHERE user_id = $1 AND anio = $2`,
    [userId, anio, guardiasAnio, vi, sa, doDelta],
  );
}

// ---------------------------------------------------------------------------
// Regla 2 — Días consecutivos (bloqueante, cruza meses)
// ---------------------------------------------------------------------------

/**
 * Lanza 422 si, tras recibir la guardia `recibe`, el usuario quedaría con
 * guardias en días consecutivos, o si ya tiene guardia ese mismo día.
 * `entrega` es la guardia que ese usuario cede en la misma operación (se ignora
 * para el cálculo, porque dejará de tenerla).
 */
async function bloquearConsecutivos(client, userId, recibe, entrega = null) {
  if (!recibe) return;
  const prev = addDays(recibe, -1);
  const next = addDays(recibe, 1);
  const { rows } = await client.query(
    'SELECT fecha FROM shifts WHERE user_id = $1 AND fecha = ANY($2::date[])',
    [userId, [prev, recibe, next]],
  );
  const tiene = new Set(rows.map((r) => toISODate(r.fecha)));
  const entregada = entrega ? toISODate(entrega) : null;

  if (tiene.has(recibe) && recibe !== entregada) {
    throw errores.reglaNegocio(`El receptor ya tiene una guardia el ${shortLabel(recibe)}.`);
  }
  const adyacentes = [];
  if (tiene.has(prev) && prev !== entregada) adyacentes.push(prev);
  if (tiene.has(next) && next !== entregada) adyacentes.push(next);
  if (adyacentes.length) {
    throw errores.reglaNegocio(
      `Operación bloqueada: dejaría al receptor con guardias en días consecutivos `
      + `(${shortLabel(recibe)} junto a ${adyacentes.map(shortLabel).join(' y ')}). `
      + 'La prohibición de días seguidos es absoluta.',
    );
  }
}

// ---------------------------------------------------------------------------
// Regla 1 — Límites Vi/Sa/Do (flag_exceso)
// ---------------------------------------------------------------------------

/**
 * Evalúa si un receptor superaría el límite del tipo de fin de semana de la
 * guardia recibida. Devuelve el objeto de exceso si nuevo > 8, o null.
 * Tiene en cuenta que el receptor puede ceder el mismo tipo de día en la
 * misma operación (intercambio), lo que compensa.
 */
async function evaluarExceso(client, user, recibe, entrega) {
  if (!recibe || !user.aplica_limites) return null;
  const rk = weekendKey(recibe);
  if (!rk) return null; // día entre semana, no cuenta para límites

  const anio = yearOf(recibe);
  const stat = await getYearStat(client, user.id, anio);
  const actual = stat ? stat[COL[rk]] : 0;
  const cedeMismoTipo = entrega && weekendKey(entrega) === rk && yearOf(entrega) === anio;
  const nuevo = actual + 1 - (cedeMismoTipo ? 1 : 0);

  if (nuevo > 8) {
    return { tipo: WEEKEND_LABEL[rk], actual, nuevo, user_id: user.id };
  }
  return null;
}

/** Movimientos por usuario según el tipo de solicitud. */
function movimientos({ tipo, deUser, aUser, guardiaDe, guardiaA }) {
  if (tipo === 'cesion') {
    return [
      { user: deUser, recibe: null, entrega: guardiaDe },
      { user: aUser, recibe: guardiaDe, entrega: null },
    ];
  }
  // intercambio
  return [
    { user: deUser, recibe: guardiaA, entrega: guardiaDe },
    { user: aUser, recibe: guardiaDe, entrega: guardiaA },
  ];
}

/**
 * Calcula el flag_exceso de la operación (peor caso entre los receptores) y
 * aplica el bloqueo de días consecutivos a cada receptor. Lanza 422 si procede.
 * Devuelve el objeto flag_exceso o null.
 */
async function validarReglas(client, ctx) {
  const movs = movimientos(ctx);
  let peorFlag = null;
  for (const mov of movs) {
    // Regla 2: bloqueo de consecutivos (solo afecta a quien recibe un día).
    await bloquearConsecutivos(client, mov.user.id, mov.recibe, mov.entrega);
    // Regla 1: cálculo de exceso.
    const flag = await evaluarExceso(client, mov.user, mov.recibe, mov.entrega);
    if (flag && (!peorFlag || flag.nuevo > peorFlag.nuevo)) {
      peorFlag = flag;
    }
  }
  return peorFlag;
}

// ---------------------------------------------------------------------------
// Validaciones de creación
// ---------------------------------------------------------------------------

async function getUser(client, id) {
  const { rows } = await client.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function usuarioTieneGuardia(client, userId, fecha) {
  const { rows } = await client.query(
    'SELECT 1 FROM shifts WHERE user_id = $1 AND fecha = $2',
    [userId, fecha],
  );
  return rows.length > 0;
}

/**
 * Valida y prepara la creación de una solicitud. Devuelve { deUser, aUser, flag }.
 * Lanza errores en español (400/403/422) si algo no cumple.
 */
async function prepararCreacion(client, { tipo, solicitante, aUserId, guardiaDe, guardiaA }) {
  if (aUserId === solicitante.id) {
    throw errores.validacion('No puedes crear una solicitud contigo mismo como destino.');
  }

  const deUser = solicitante;
  const aUser = await getUser(client, aUserId);
  if (!aUser || !aUser.activo) {
    throw errores.validacion('El compañero destino no existe o está dado de baja.');
  }
  if (!aUser.hace_guardias) {
    throw errores.validacion('El compañero destino no hace guardias.');
  }
  if (!deUser.hace_guardias) {
    throw errores.prohibido('Tu perfil no hace guardias, no puedes ofrecer guardias.');
  }

  // La guardia ofrecida debe ser propia del solicitante.
  if (!(await usuarioTieneGuardia(client, deUser.id, guardiaDe))) {
    throw errores.validacion(`No tienes asignada la guardia del ${shortLabel(guardiaDe)}. Solo puedes ofrecer tus propias guardias.`);
  }

  if (tipo === 'intercambio') {
    if (!guardiaA) {
      throw errores.validacion('Un intercambio requiere indicar la guardia del compañero (guardia_a).');
    }
    if (!(await usuarioTieneGuardia(client, aUser.id, guardiaA))) {
      throw errores.validacion(`El compañero no tiene asignada la guardia del ${shortLabel(guardiaA)}.`);
    }
  } else if (guardiaA) {
    throw errores.validacion('Una cesión no lleva guardia del compañero (guardia_a debe ser nula).');
  }

  const flag = await validarReglas(client, {
    tipo, deUser, aUser, guardiaDe, guardiaA: tipo === 'intercambio' ? guardiaA : null,
  });

  return { deUser, aUser, flag };
}

// ---------------------------------------------------------------------------
// Ejecución de la aprobación (reasigna guardias + recalcula contadores)
// ---------------------------------------------------------------------------

/** Reasigna la fila de shift de `fecha` del usuario `from` al usuario `to`. */
async function reasignarShift(client, fecha, from, to) {
  const { rowCount } = await client.query(
    'UPDATE shifts SET user_id = $3 WHERE fecha = $1 AND user_id = $2',
    [fecha, from, to],
  );
  if (rowCount === 0) {
    throw errores.reglaNegocio(
      `La guardia del ${shortLabel(fecha)} ya no está asignada como se esperaba (pudo cambiar desde que se creó la solicitud).`,
    );
  }
}

/**
 * Ejecuta el cambio aprobado: re-valida las reglas con el estado actual,
 * reasigna los Shift reales y ajusta los contadores anuales de los implicados.
 * Devuelve el flag_exceso recalculado (para auditoría).
 */
async function ejecutarCambio(client, request, { confirmar = false } = {}) {
  const deUser = await getUser(client, request.de_user_id);
  const aUser = await getUser(client, request.a_user_id);
  if (!deUser || !aUser) {
    throw errores.reglaNegocio('Alguno de los usuarios implicados ya no existe.');
  }

  const guardiaDe = toISODate(request.guardia_de);
  const guardiaA = request.guardia_a ? toISODate(request.guardia_a) : null;

  // Re-evaluar reglas con el estado ACTUAL (puede haber cambiado desde la creación).
  const flag = await validarReglas(client, {
    tipo: request.tipo, deUser, aUser, guardiaDe, guardiaA,
  });

  // Si hay exceso de límite, exige doble confirmación del tutor.
  if (flag && !confirmar) {
    throw errores.reglaNegocio(
      `Este cambio supera el límite de ${flag.tipo} (${flag.actual} → ${flag.nuevo}). `
      + 'Requiere confirmación explícita del tutor: vuelve a aprobar con { "confirmar": true }.',
      { flag_exceso: flag },
    );
  }

  if (request.tipo === 'cesion') {
    // de → a en guardiaDe
    await reasignarShift(client, guardiaDe, deUser.id, aUser.id);
    const yDe = yearOf(guardiaDe);
    const kDe = weekendKey(guardiaDe);
    await aplicarDeltaContador(client, deUser.id, yDe, {
      guardiasAnio: -1, ...(kDe && deUser.aplica_limites ? { [kDe]: -1 } : {}),
    });
    await aplicarDeltaContador(client, aUser.id, yDe, {
      guardiasAnio: +1, ...(kDe && aUser.aplica_limites ? { [kDe]: +1 } : {}),
    });
  } else {
    // intercambio: de cede guardiaDe y recibe guardiaA; a al revés.
    await reasignarShift(client, guardiaDe, deUser.id, aUser.id);
    await reasignarShift(client, guardiaA, aUser.id, deUser.id);
    const yDe = yearOf(guardiaDe);
    const yA = yearOf(guardiaA);
    const kDe = weekendKey(guardiaDe);
    const kA = weekendKey(guardiaA);
    // de: pierde guardiaDe, gana guardiaA
    await aplicarDeltaContador(client, deUser.id, yDe, { guardiasAnio: -1, ...(kDe && deUser.aplica_limites ? { [kDe]: -1 } : {}) });
    await aplicarDeltaContador(client, deUser.id, yA, { guardiasAnio: +1, ...(kA && deUser.aplica_limites ? { [kA]: +1 } : {}) });
    // a: pierde guardiaA, gana guardiaDe
    await aplicarDeltaContador(client, aUser.id, yA, { guardiasAnio: -1, ...(kA && aUser.aplica_limites ? { [kA]: -1 } : {}) });
    await aplicarDeltaContador(client, aUser.id, yDe, { guardiasAnio: +1, ...(kDe && aUser.aplica_limites ? { [kDe]: +1 } : {}) });
  }

  return flag;
}

module.exports = {
  getYearStat,
  aplicarDeltaContador,
  bloquearConsecutivos,
  evaluarExceso,
  validarReglas,
  prepararCreacion,
  ejecutarCambio,
  getUser,
};

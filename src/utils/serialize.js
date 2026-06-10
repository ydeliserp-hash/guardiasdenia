'use strict';

/**
 * Serializadores: convierten filas de la BD a la forma EXACTA que el frontend
 * ya espera (claves del mock.js: `ini`, `guardias`, `limites`, `de`, `a`,
 * `guardiaDe`, `status`, `icon`, `ref`, ...). Así el prototipo funciona sin
 * tocar el frontend. Los campos nuevos (auditoría) van en snake_case.
 */

const { toISODate, monthOf } = require('./dates');
const dates = require('./dates');

/** Tiempo relativo en español: "hace 2 h", "ayer", "hace 3 días". */
function relativeEs(value, now = new Date()) {
  if (!value) return null;
  const then = value instanceof Date ? value : new Date(value);
  const diffMs = now.getTime() - then.getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  const horas = Math.round(min / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  if (dias === 1) return 'ayer';
  if (dias < 7) return `hace ${dias} días`;
  const semanas = Math.round(dias / 7);
  if (semanas === 1) return 'hace 1 semana';
  if (semanas < 5) return `hace ${semanas} semanas`;
  const meses = Math.round(dias / 30);
  return meses <= 1 ? 'hace 1 mes' : `hace ${meses} meses`;
}

/** Usuario en la forma del prototipo. Nunca expone password_hash. */
function serializeUser(row, { incluirCodigo = false } = {}) {
  if (!row) return null;
  const out = {
    id: row.id,
    nombre: row.nombre,
    trato: row.trato,
    ini: row.iniciales,
    dni: row.dni,
    role: row.role,
    anio: row.anio,
    color: row.color,
    guardias: row.hace_guardias,
    limites: row.aplica_limites,
    activo: row.activo,
    // true si la cuenta aún no tiene contraseña (pendiente de primer acceso)
    pendiente_activacion: row.password_hash == null,
  };
  if (incluirCodigo) {
    out.activation_code = row.activation_code;
  }
  return out;
}

/** Detalle de una guardia para los objetos guardiaDe/guardiaA. */
function guardiaInfo(iso) {
  if (!iso) return null;
  const fecha = toISODate(iso);
  return {
    fecha,
    d: Number(fecha.slice(8, 10)),
    label: dates.shortLabel(fecha),
  };
}

/** Solicitud de cambio/cesión en la forma del prototipo. */
function serializeRequest(row, now = new Date()) {
  if (!row) return null;
  return {
    id: row.id,
    tipo: row.tipo,
    de: row.de_user_id,
    a: row.a_user_id,
    guardiaDe: guardiaInfo(row.guardia_de),
    guardiaA: row.guardia_a ? guardiaInfo(row.guardia_a) : null,
    status: row.estado,
    flag: row.flag_exceso || null,
    nota: row.nota || undefined,
    motivo: row.motivo || undefined,
    fecha: relativeEs(row.creada_en, now),
    creada_en: row.creada_en,
  };
}

/** Notificación en la forma del prototipo. */
function serializeNotification(row, now = new Date()) {
  if (!row) return null;
  return {
    id: row.id,
    tipo: row.tipo,
    icon: row.icono,
    titulo: row.titulo,
    cuerpo: row.cuerpo,
    fecha: relativeEs(row.creada_en, now),
    leida: row.leida,
    ref: row.ref_request_id || undefined,
    creada_en: row.creada_en,
  };
}

/** Entrada del histórico de auditoría (campos nuevos, snake_case). */
function serializeAudit(row) {
  if (!row) return null;
  return {
    id: row.id,
    entidad: row.entidad,
    entidad_id: row.entidad_id,
    accion: row.accion,
    actor_id: row.actor_id,
    estado_anterior: row.estado_anterior,
    estado_nuevo: row.estado_nuevo,
    detalle: row.detalle,
    creado_en: row.creado_en,
  };
}

/**
 * Estadística por residente con flags de límite.
 * `mes` = guardias del mes en curso (calculado en vivo desde shifts).
 * `anio` = total de guardias del año (contador almacenado).
 */
function flagDe(valor, aplica) {
  if (!aplica) return null;       // externos sin límites
  if (valor > 8) return 'rojo';   // exceso
  if (valor === 8) return 'ambar'; // límite alcanzado
  return null;
}

function serializeStats(statRow, guardiasMes, aplicaLimites) {
  return {
    mes: guardiasMes,
    guardias_mes: guardiasMes,
    anio: statRow ? statRow.guardias_anio : 0,
    vi: statRow ? statRow.vi : 0,
    sa: statRow ? statRow.sa : 0,
    do: statRow ? statRow.do_ : 0,
    limite: 8,
    aplica_limites: aplicaLimites,
    flags: {
      vi: flagDe(statRow ? statRow.vi : 0, aplicaLimites),
      sa: flagDe(statRow ? statRow.sa : 0, aplicaLimites),
      do: flagDe(statRow ? statRow.do_ : 0, aplicaLimites),
    },
  };
}

module.exports = {
  relativeEs,
  serializeUser,
  serializeRequest,
  serializeNotification,
  serializeAudit,
  serializeStats,
  guardiaInfo,
};

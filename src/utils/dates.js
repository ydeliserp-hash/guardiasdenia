'use strict';

/**
 * Utilidades de fechas en español, sin dependencias de zona horaria:
 * trabajamos siempre con fechas "civiles" en formato YYYY-MM-DD.
 */

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const MESES_ABBR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
// 0=domingo … 6=sábado (convención de getUTCDay)
const DOW_ABBR = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/** Normaliza a 'YYYY-MM-DD'. Acepta string o Date. */
function toISODate(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    // Recorta una posible parte de tiempo.
    return value.slice(0, 10);
  }
  throw new Error('Fecha inválida');
}

/** Comprueba el formato YYYY-MM-DD y que sea una fecha real. */
function isValidISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Día de la semana 0..6 (0=domingo) en UTC, sin saltos de zona. */
function dayOfWeek(iso) {
  const [y, m, d] = toISODate(iso).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Año natural de la fecha. */
function yearOf(iso) {
  return Number(toISODate(iso).slice(0, 4));
}

/** Mes 1..12 de la fecha. */
function monthOf(iso) {
  return Number(toISODate(iso).slice(5, 7));
}

/** Devuelve la fecha desplazada `delta` días (puede cruzar mes/año). */
function addDays(iso, delta) {
  const [y, m, d] = toISODate(iso).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

/**
 * Tipo de fin de semana de la fecha, o null si es día entre semana.
 * Devuelve la clave usada en los contadores: 'vi' | 'sa' | 'do'.
 */
function weekendKey(iso) {
  const dow = dayOfWeek(iso);
  if (dow === 5) return 'vi';
  if (dow === 6) return 'sa';
  if (dow === 0) return 'do';
  return null;
}

/** Etiqueta plural usada en flag_exceso y mensajes: 'viernes'|'sábados'|'domingos'. */
const WEEKEND_LABEL = { vi: 'viernes', sa: 'sábados', do: 'domingos' };

/** Etiqueta tipo "Mié 10 jun" como en el prototipo. */
function shortLabel(iso) {
  const [, m, d] = toISODate(iso).split('-').map(Number);
  return `${DOW_ABBR[dayOfWeek(iso)]} ${d} ${MESES_ABBR[m - 1]}`;
}

module.exports = {
  MESES,
  MESES_ABBR,
  DOW_ABBR,
  WEEKEND_LABEL,
  toISODate,
  isValidISODate,
  dayOfWeek,
  yearOf,
  monthOf,
  addDays,
  weekendKey,
  shortLabel,
};

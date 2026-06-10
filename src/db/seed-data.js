'use strict';

/**
 * Datos canónicos del prototipo (mock.js), compartidos por:
 *   - src/db/seed.js            (siembra vía Node/pg)
 *   - src/db/gen-supabase-sql.js (genera supabase_setup.sql para el editor web)
 *
 * Mantener una sola fuente evita que ambos caminos se desincronicen.
 */

const jun = (d) => `2026-06-${String(d).padStart(2, '0')}`;

// Usuarios (mismas claves/valores que mock.js).
const USERS = [
  { id: 'carmen', nombre: 'Carmen Bisbal', trato: 'Dra. Carmen Bisbal', ini: 'CB', dni: '21456789X', role: 'tutor', anio: 'Tutora', color: 'lavanda', guardias: false, limites: true },
  { id: 'marta', nombre: 'Marta Espí', trato: 'Marta Espí', ini: 'ME', dni: '48721903K', role: 'r4', anio: 'R4', color: 'cielo', guardias: true, limites: true },
  { id: 'javier', nombre: 'Javier Morand', trato: 'Javier Morand', ini: 'JM', dni: '20098451T', role: 'r4', anio: 'R4', color: 'salvia', guardias: true, limites: true },
  { id: 'lucia', nombre: 'Lucía Sendra', trato: 'Lucía Sendra', ini: 'LS', dni: '53110874P', role: 'residente', anio: 'R3', color: 'rosa', guardias: true, limites: true },
  { id: 'hugo', nombre: 'Hugo Ferrer', trato: 'Hugo Ferrer', ini: 'HF', dni: '44903217M', role: 'residente', anio: 'R2', color: 'melocoton', guardias: true, limites: true },
  { id: 'aitana', nombre: 'Aitana Roselló', trato: 'Aitana Roselló', ini: 'AR', dni: '49872013D', role: 'residente', anio: 'R2', color: 'amarillo', guardias: true, limites: true },
  { id: 'pablo', nombre: 'Pablo Mengual', trato: 'Pablo Mengual', ini: 'PM', dni: '26540918L', role: 'residente', anio: 'R1', color: 'menta', guardias: true, limites: true },
  { id: 'nerea', nombre: 'Nerea Vidal', trato: 'Nerea Vidal', ini: 'NV', dni: '51230496G', role: 'residente', anio: 'R1', color: 'bebe', guardias: true, limites: true },
  { id: 'tomas', nombre: 'Tomás Gilabert', trato: 'Dr. Tomás Gilabert', ini: 'TG', dni: '30019283F', role: 'externo', anio: 'Externo', color: 'coral', guardias: true, limites: false },
];

// Calendario junio 2026 (día → [userId, ...]).
const SHIFTS = {
  1: ['lucia'], 2: ['hugo', 'pablo'], 3: ['aitana'], 4: ['nerea', 'tomas'],
  5: ['marta', 'hugo'], 6: ['javier'], 7: ['pablo', 'aitana'],
  8: ['lucia'], 9: ['nerea'], 10: ['hugo', 'javier'], 11: ['aitana'],
  12: ['pablo', 'nerea'], 13: ['lucia', 'hugo'], 14: ['tomas'],
  15: ['marta'], 16: ['aitana', 'pablo'], 17: ['nerea'], 18: ['hugo', 'lucia'],
  19: ['javier'], 20: ['aitana', 'marta'], 21: ['pablo'],
  22: ['nerea', 'tomas'], 23: ['lucia'], 24: ['hugo', 'aitana'], 25: ['pablo'],
  26: ['nerea', 'javier'], 27: ['lucia', 'marta'], 28: ['hugo'],
  29: ['aitana', 'pablo'], 30: ['nerea'],
};

// Contadores anuales (guardias_anio, vi, sa, do).
const STATS = {
  2026: {
    marta: { anio: 28, vi: 5, sa: 6, do: 4 },
    javier: { anio: 25, vi: 4, sa: 5, do: 6 },
    lucia: { anio: 31, vi: 7, sa: 7, do: 6 },
    hugo: { anio: 30, vi: 6, sa: 7, do: 5 },
    aitana: { anio: 33, vi: 7, sa: 8, do: 7 }, // ámbar: sábados 8/8
    pablo: { anio: 29, vi: 6, sa: 6, do: 5 },
    nerea: { anio: 34, vi: 9, sa: 7, do: 6 }, // rojo: viernes 9/8
    tomas: { anio: 12, vi: 2, sa: 3, do: 2 }, // externo (límites off)
  },
  2025: {
    marta: { anio: 46, vi: 7, sa: 7, do: 6 },
    javier: { anio: 44, vi: 6, sa: 7, do: 7 },
    lucia: { anio: 49, vi: 8, sa: 6, do: 7 },
    hugo: { anio: 41, vi: 5, sa: 6, do: 6 },
    aitana: { anio: 47, vi: 7, sa: 7, do: 8 },
    pablo: { anio: 38, vi: 5, sa: 5, do: 4 },
    nerea: { anio: 40, vi: 6, sa: 5, do: 5 },
    tomas: { anio: 18, vi: 3, sa: 4, do: 3 },
  },
};

// Solicitudes rq1..rq6 (IDs fijos para que las notificaciones puedan referenciarlas).
const REQUESTS = [
  { id: '11111111-1111-4111-8111-111111111111', key: 'rq1', tipo: 'intercambio', de: 'hugo', a: 'lucia', guardiaDe: jun(10), guardiaA: jun(8), estado: 'pend_companero', flag: null, horas: 2, nota: '¿Te viene bien cambiar? Tengo una cita médica el día 10.', motivo: null },
  { id: '22222222-2222-4222-8222-222222222222', key: 'rq2', tipo: 'cesion', de: 'lucia', a: 'aitana', guardiaDe: jun(23), guardiaA: null, estado: 'pend_tutor', flag: null, horas: 26, nota: 'Te cedo la guardia del 23.', motivo: null },
  { id: '33333333-3333-4333-8333-333333333333', key: 'rq3', tipo: 'intercambio', de: 'nerea', a: 'javier', guardiaDe: jun(17), guardiaA: jun(19), estado: 'aprobada', flag: null, horas: 72, nota: null, motivo: null },
  { id: '44444444-4444-4444-8444-444444444444', key: 'rq4', tipo: 'cesion', de: 'pablo', a: 'aitana', guardiaDe: jun(27), guardiaA: null, estado: 'pend_tutor', flag: { tipo: 'sábados', actual: 8, nuevo: 9, user_id: 'aitana' }, horas: 5, nota: '¿Me cubres el sábado 27? Te lo devuelvo en julio.', motivo: null },
  { id: '55555555-5555-4555-8555-555555555555', key: 'rq5', tipo: 'intercambio', de: 'tomas', a: 'nerea', guardiaDe: jun(22), guardiaA: jun(9), estado: 'rechazada', flag: null, horas: 96, nota: null, motivo: 'No puedo ese día, lo siento.' },
  { id: '66666666-6666-4666-8666-666666666666', key: 'rq6', tipo: 'cesion', de: 'marta', a: 'pablo', guardiaDe: jun(15), guardiaA: null, estado: 'cancelada', flag: null, horas: 168, nota: null, motivo: null },
];

// Notificaciones del residente actual (lucia). `ref` apunta a la key de REQUESTS.
const NOTIS = [
  { tipo: 'solicitud', icono: 'swap', titulo: 'Hugo Ferrer te propone un intercambio', cuerpo: 'Su guardia del 10 jun por la tuya del 8 jun.', horas: 2, leida: false, ref: 'rq1' },
  { tipo: 'plan', icono: 'cal', titulo: 'Plan de guardias de junio publicado', cuerpo: 'La Dra. Bisbal ha publicado el calendario del mes.', horas: 6, leida: false, ref: null },
  { tipo: 'estado', icono: 'clock', titulo: 'Tu cesión a Aitana está pendiente del tutor', cuerpo: 'Aitana aceptó la guardia del 23 jun. Esperando aprobación.', horas: 26, leida: true, ref: 'rq2' },
  { tipo: 'aprobada', icono: 'check', titulo: 'Cambio aprobado por la tutora', cuerpo: 'El intercambio entre Nerea y Javier ha sido aprobado.', horas: 72, leida: true, ref: 'rq3' },
  { tipo: 'recordatorio', icono: 'bell', titulo: 'Recordatorio de guardia', cuerpo: 'Tienes guardia el sábado 13 de junio junto a Hugo.', horas: 72, leida: true, ref: null },
];

module.exports = { jun, USERS, SHIFTS, STATS, REQUESTS, NOTIS };

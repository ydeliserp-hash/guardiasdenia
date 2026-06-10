'use strict';

const { toISODate } = require('../utils/dates');

const ADMIN_ROLES = ['r4', 'tutor'];
const esAdmin = (role) => ADMIN_ROLES.includes(role);

const pad2 = (n) => String(n).padStart(2, '0');

/** Rango [inicio, finExclusivo) del mes en formato ISO. */
function rangoMes(anio, mes) {
  const inicio = `${anio}-${pad2(mes)}-01`;
  const finExclusivo = mes === 12 ? `${anio + 1}-01-01` : `${anio}-${pad2(mes + 1)}-01`;
  return { inicio, finExclusivo };
}

/** Devuelve la planilla del mes, o null. Acepta un client o el helper query. */
async function getPlan(db, anio, mes) {
  const { rows } = await db.query(
    'SELECT * FROM month_plans WHERE anio = $1 AND mes = $2',
    [anio, mes],
  );
  return rows[0] || null;
}

/** Devuelve la planilla del mes; la crea en estado 'borrador' si no existe. */
async function getOrCreatePlan(client, anio, mes) {
  const existente = await getPlan(client, anio, mes);
  if (existente) return existente;
  const { rows } = await client.query(
    "INSERT INTO month_plans (anio, mes, estado) VALUES ($1, $2, 'borrador') RETURNING *",
    [anio, mes],
  );
  return rows[0];
}

/**
 * Mapa de guardias del mes con la forma del prototipo: { díaDelMes: [userId, ...] }.
 * Ordena por slot para que el primer residente del día sea estable.
 */
async function mapaGuardiasMes(db, anio, mes) {
  const { inicio, finExclusivo } = rangoMes(anio, mes);
  const { rows } = await db.query(
    `SELECT fecha, user_id, slot FROM shifts
       WHERE fecha >= $1 AND fecha < $2
       ORDER BY fecha, slot`,
    [inicio, finExclusivo],
  );
  const mapa = {};
  for (const r of rows) {
    const dia = Number(toISODate(r.fecha).slice(8, 10));
    if (!mapa[dia]) mapa[dia] = [];
    mapa[dia].push(r.user_id);
  }
  return mapa;
}

/** Cuenta de guardias de cada usuario en un mes concreto. */
async function conteoGuardiasMes(db, anio, mes) {
  const { inicio, finExclusivo } = rangoMes(anio, mes);
  const { rows } = await db.query(
    `SELECT user_id, COUNT(*)::int AS n FROM shifts
       WHERE fecha >= $1 AND fecha < $2
       GROUP BY user_id`,
    [inicio, finExclusivo],
  );
  const out = {};
  for (const r of rows) out[r.user_id] = r.n;
  return out;
}

module.exports = {
  ADMIN_ROLES,
  esAdmin,
  rangoMes,
  getPlan,
  getOrCreatePlan,
  mapaGuardiasMes,
  conteoGuardiasMes,
};

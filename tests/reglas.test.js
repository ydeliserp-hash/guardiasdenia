'use strict';
/* Verificación de la lógica de negocio SIN base de datos (cliente simulado). */
const assert = require('assert');
const dates = require('../src/utils/dates');
const cr = require('../src/services/changeRequests');

let pasados = 0;
const ok = (msg) => { pasados += 1; console.log('  ✓', msg); };

(async () => {
  // ---- Fechas / fin de semana ----
  assert.strictEqual(dates.dayOfWeek('2026-06-01'), 1, 'lun');           // 1 jun 2026 = lunes
  assert.strictEqual(dates.weekendKey('2026-06-05'), 'vi');             // viernes
  assert.strictEqual(dates.weekendKey('2026-06-06'), 'sa');             // sábado
  assert.strictEqual(dates.weekendKey('2026-06-07'), 'do');             // domingo
  assert.strictEqual(dates.weekendKey('2026-06-10'), null);            // miércoles
  assert.strictEqual(dates.addDays('2026-06-30', 1), '2026-07-01');    // cruza mes
  assert.strictEqual(dates.addDays('2026-01-01', -1), '2025-12-31');   // cruza año
  assert.strictEqual(dates.shortLabel('2026-06-10'), 'Mié 10 jun');
  ok('fechas, weekendKey y addDays (cruce de mes/año) correctos');

  // ---- Cliente simulado ----
  function makeClient({ shifts = {}, stats = {} }) {
    return {
      async query(sql, params) {
        if (sql.includes('FROM shifts WHERE user_id') && sql.includes('ANY')) {
          const [userId, fechas] = params;
          const tiene = shifts[userId] || [];
          return { rows: fechas.filter((f) => tiene.includes(f)).map((fecha) => ({ fecha })) };
        }
        if (sql.includes('FROM shifts WHERE user_id') && sql.includes('AND fecha =')) {
          const [userId, fecha] = params;
          return { rows: (shifts[userId] || []).includes(fecha) ? [{ ok: 1 }] : [] };
        }
        if (sql.includes('ISODOW')) {
          // contarAnual: contadores derivados del calendario publicado
          const [userId, anio] = params;
          const s = (stats[userId] || {})[anio];
          return { rows: [{ guardias_anio: (s && s.anio) || 0, vi: (s && s.vi) || 0, sa: (s && s.sa) || 0, do_: (s && s.do) || 0 }] };
        }
        return { rows: [] };
      },
    };
  }

  // ---- Regla 2: días consecutivos (bloqueo, cruza meses) ----
  const c1 = makeClient({ shifts: { lucia: ['2026-06-09', '2026-06-30'] } });
  // recibe 2026-06-08 (adyacente a 09) → bloqueo
  await assert.rejects(() => cr.bloquearConsecutivos(c1, 'lucia', '2026-06-08', null), /consecutivos/i);
  ok('bloqueo de días consecutivos (08 junto a 09)');
  // recibe 2026-07-01 (adyacente a 30 jun, cruza mes) → bloqueo
  await assert.rejects(() => cr.bloquearConsecutivos(c1, 'lucia', '2026-07-01', null), /consecutivos/i);
  ok('bloqueo de consecutivos cruzando meses (30 jun ↔ 1 jul)');
  // recibe 2026-06-15 (sin adyacentes) → permitido
  await cr.bloquearConsecutivos(c1, 'lucia', '2026-06-15', null);
  ok('permite recepción sin días adyacentes');
  // recibe un día que ya tiene → bloqueo (duplicado)
  await assert.rejects(() => cr.bloquearConsecutivos(c1, 'lucia', '2026-06-09', null), /ya tiene/i);
  ok('bloqueo por guardia duplicada el mismo día');
  // adyacente que se ENTREGA en la misma operación → no bloquea
  await cr.bloquearConsecutivos(c1, 'lucia', '2026-06-08', '2026-06-09');
  ok('no bloquea si el día adyacente se entrega en la misma operación');

  // ---- Regla 1: exceso de límite (flag_exceso) ----
  // Aitana sábados 8/8 recibe un sábado → 9/8 → flag rojo
  const c2 = makeClient({ stats: { aitana: { 2026: { sa: 8 } } } });
  const aitana = { id: 'aitana', aplica_limites: true };
  const flag = await cr.evaluarExceso(c2, aitana, '2026-06-27', null); // 27 jun 2026 = sábado
  assert.deepStrictEqual(flag, { tipo: 'sábados', actual: 8, nuevo: 9, user_id: 'aitana' });
  ok('flag_exceso de Aitana (sábados 8 → 9) calculado correctamente');
  // Externo con límites desactivados → sin flag
  const tomas = { id: 'tomas', aplica_limites: false };
  assert.strictEqual(await cr.evaluarExceso(c2, tomas, '2026-06-27', null), null);
  ok('externo sin límites no genera flag');
  // Día entre semana → sin flag
  assert.strictEqual(await cr.evaluarExceso(c2, aitana, '2026-06-24', null), null);
  ok('día entre semana no genera flag');
  // Intercambio que compensa el mismo tipo (cede otro sábado) → sin flag
  const flagComp = await cr.evaluarExceso(c2, aitana, '2026-06-27', '2026-06-20'); // recibe sáb 27, cede sáb 20
  assert.strictEqual(flagComp, null);
  ok('intercambio que cede el mismo tipo de día no supera el límite');

  // ---- Regla 1 en intercambio: peor caso entre ambos receptores ----
  const c3 = makeClient({
    shifts: { aitana: ['2026-06-17'], pablo: ['2026-06-27'] },
    stats: { aitana: { 2026: { sa: 8 } }, pablo: { 2026: { sa: 6 } } },
  });
  const pablo = { id: 'pablo', aplica_limites: true };
  // intercambio: pablo cede sáb 27 y recibe mié 17 (sin impacto FDS);
  // aitana cede mié 17 y recibe sáb 27 → sábados 8 → 9 (exceso).
  const peor = await cr.validarReglas(c3, {
    tipo: 'intercambio', deUser: pablo, aUser: aitana, guardiaDe: '2026-06-27', guardiaA: '2026-06-17',
  });
  assert.deepStrictEqual(peor, { tipo: 'sábados', actual: 8, nuevo: 9, user_id: 'aitana' });
  ok('intercambio evalúa ambos lados y guarda el peor exceso (Aitana 9)');

  console.log(`\n✅ ${pasados} comprobaciones de reglas de negocio superadas.`);
})().catch((e) => { console.error('\n❌ Falló una comprobación:', e.message); process.exit(1); });

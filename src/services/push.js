'use strict';

/**
 * Notificaciones push (Web Push / VAPID).
 *
 * Las claves VAPID se generan automáticamente la primera vez y se guardan en
 * la tabla push_config (no hay nada que configurar en el hosting). Los envíos
 * son "mejor esfuerzo": cualquier fallo se registra y nunca rompe la acción
 * de negocio que los dispara. Las suscripciones caducadas se limpian solas.
 */

const webpush = require('web-push');
const { query } = require('../config/db');

const VAPID_SUBJECT = 'mailto:ydeliserp@gmail.com';

let vapidCache = null;

/** Devuelve el par de claves VAPID, creándolo si aún no existe. */
async function getVapid() {
  if (vapidCache) return vapidCache;
  const { rows } = await query('SELECT public_key, private_key FROM push_config WHERE id = 1');
  if (rows[0]) {
    vapidCache = rows[0];
    return vapidCache;
  }
  const keys = webpush.generateVAPIDKeys();
  await query(
    'INSERT INTO push_config (id, public_key, private_key) VALUES (1, $1, $2) ON CONFLICT (id) DO NOTHING',
    [keys.publicKey, keys.privateKey],
  );
  // Releer por si otra instancia ganó la carrera del INSERT.
  const { rows: rows2 } = await query('SELECT public_key, private_key FROM push_config WHERE id = 1');
  vapidCache = rows2[0];
  return vapidCache;
}

/** Guarda (o renueva) la suscripción de un dispositivo del usuario. */
async function guardarSuscripcion(userId, sub) {
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, claves)
     VALUES ($1, $2, $3)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, claves = EXCLUDED.claves`,
    [userId, sub.endpoint, JSON.stringify(sub.keys)],
  );
}

/** Borra una suscripción (logout, toggle off o endpoint caducado). */
async function borrarSuscripcion(endpoint, userId = null) {
  if (userId) {
    await query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, userId]);
  } else {
    await query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
  }
}

/**
 * Envía una push a TODOS los dispositivos suscritos de un usuario.
 * payload: { titulo, cuerpo, url? }
 */
async function enviarPush(userId, payload) {
  try {
    const { rows } = await query(
      'SELECT endpoint, claves FROM push_subscriptions WHERE user_id = $1',
      [userId],
    );
    if (!rows.length) return;

    const { public_key: pub, private_key: priv } = await getVapid();
    webpush.setVapidDetails(VAPID_SUBJECT, pub, priv);

    await Promise.all(rows.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: s.claves },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 24 },
        );
      } catch (err) {
        // 404/410 = suscripción caducada → limpiar
        if (err.statusCode === 404 || err.statusCode === 410) {
          await borrarSuscripcion(s.endpoint).catch(() => {});
        } else {
          console.error('Push fallida:', err.statusCode || err.message);
        }
      }
    }));
  } catch (err) {
    // p. ej. tablas aún no creadas: nunca romper la acción de negocio
    console.error('Push omitida:', err.message);
  }
}

/** Push a todos los tutores activos. */
async function enviarPushTutores(payload) {
  try {
    const { rows } = await query("SELECT id FROM users WHERE role = 'tutor' AND activo = TRUE");
    await Promise.all(rows.map((r) => enviarPush(r.id, payload)));
  } catch (err) {
    console.error('Push tutores omitida:', err.message);
  }
}

module.exports = { getVapid, guardarSuscripcion, borrarSuscripcion, enviarPush, enviarPushTutores };

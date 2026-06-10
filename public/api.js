/* ============================================================
   Cliente de la API real — sustituye los datos simulados.
   Se carga después de mock.js: GD conserva las constantes de
   diseño (colores, meses, días) y la API rellena los datos.
   ============================================================ */
(function () {
  // Mismo origen en producción (el frontend se sirve junto a la API).
  // En desarrollo local apunta al backend en :4000. Se puede forzar
  // definiendo window.API_URL antes de cargar este archivo.
  const API_URL = window.API_URL !== undefined
    ? window.API_URL
    : (['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://localhost:4000' : '');

  let token = localStorage.getItem('gd_token') || null;

  async function call(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(API_URL + path, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new Error('No hay conexión con el servidor. Revisa tu internet.');
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* respuesta sin cuerpo */ }
    if (!res.ok) {
      const err = new Error((data && data.error && data.error.mensaje) || 'Error del servidor.');
      err.codigo = data && data.error && data.error.codigo;
      err.detalles = data && data.error && data.error.detalles;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  // m0 = mes 0-indexado (como usa el frontend)
  const iso = (y, m0, d) => y + '-' + pad2(m0 + 1) + '-' + pad2(d);

  window.API = {
    get token() { return token; },
    setToken(t) {
      token = t;
      if (t) localStorage.setItem('gd_token', t);
      else localStorage.removeItem('gd_token');
    },
    iso,

    // --- Autenticación ---
    login: (dni, password) => call('/auth/login', { method: 'POST', body: { dni, password } }),
    primerAcceso: (dni, codigo) => call('/auth/primer-acceso', { method: 'POST', body: { dni, codigo } }),
    crearPassword: (tempToken, password) => call('/auth/crear-password', { method: 'POST', body: { tempToken, password } }),
    me: () => call('/auth/me'),

    // --- Datos ---
    usuarios: () => call('/usuarios'),
    plan: (anio, mes1) => call('/planes?anio=' + anio + '&mes=' + mes1),
    estadisticas: (anio, mes1) => call('/estadisticas?anio=' + anio + (mes1 ? '&mes=' + mes1 : '')),
    solicitudes: () => call('/solicitudes'),
    notificaciones: () => call('/notificaciones'),

    // --- Acciones ---
    crearSolicitud: (body) => call('/solicitudes', { method: 'POST', body }),
    aceptarSolicitud: (id) => call('/solicitudes/' + id + '/aceptar', { method: 'POST', body: {} }),
    rechazarSolicitud: (id, motivo) => call('/solicitudes/' + id + '/rechazar', { method: 'POST', body: motivo ? { motivo } : {} }),
    aprobarSolicitud: (id, confirmar) => call('/solicitudes/' + id + '/aprobar', { method: 'POST', body: confirmar ? { confirmar: true } : {} }),
    cancelarSolicitud: (id) => call('/solicitudes/' + id + '/cancelar', { method: 'POST', body: {} }),
    leerNoti: (id) => call('/notificaciones/' + id + '/leer', { method: 'POST', body: {} }),
    leerTodasNotis: () => call('/notificaciones/marcar-leidas', { method: 'POST', body: {} }),
    asignarGuardia: (fechaIso, userIds) => call('/guardias/' + fechaIso, { method: 'PUT', body: { user_ids: userIds } }),
    publicarPlan: (anio, mes1) => call('/planes/' + anio + '/' + mes1 + '/publicar', { method: 'POST', body: {} }),
    borradorPlan: (anio, mes1) => call('/planes/' + anio + '/' + mes1 + '/borrador', { method: 'POST', body: {} }),
    altaUsuario: (body) => call('/usuarios', { method: 'POST', body }),
    editarUsuario: (id, body) => call('/usuarios/' + id, { method: 'PATCH', body }),
    bajaUsuario: (id) => call('/usuarios/' + id, { method: 'DELETE' }),

    // --- Notificaciones push ---
    pushClave: () => call('/push/clave-publica'),
    pushSuscribir: (sub) => call('/push/suscribir', { method: 'POST', body: sub }),
    pushBaja: (endpoint) => call('/push/baja', { method: 'POST', body: { endpoint } }),

    // --- Otros ---
    icalEnlace: () => call('/ical/enlace'),
    auditoria: (filtros) => {
      const q = Object.entries(filtros || {})
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
      return call('/auditoria' + (q ? '?' + q : ''));
    },
  };
})();

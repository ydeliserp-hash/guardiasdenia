/* Service worker — notificaciones push de Guardias (H. U. de Dénia) */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let datos = {};
  try { datos = e.data ? e.data.json() : {}; } catch (err) { /* payload no JSON */ }
  const titulo = datos.titulo || 'Guardias · H. U. de Dénia';
  const opciones = {
    body: datos.cuerpo || '',
    icon: 'assets/icon-192.png',
    badge: 'assets/icon-192.png',
    lang: 'es',
    data: { url: datos.url || '/' },
  };
  e.waitUntil(self.registration.showNotification(titulo, opciones));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      for (const c of lista) {
        if ('focus' in c) return c.focus();
      }
      return clients.openWindow(url);
    }),
  );
});

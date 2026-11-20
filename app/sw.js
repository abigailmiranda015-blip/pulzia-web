// Pulzia: service worker mínimo para que la app se pueda instalar en el celular.
// No guarda nada en caché: todo sigue viniendo de internet como siempre.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

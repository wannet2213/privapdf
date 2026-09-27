// Dev kill-switch: never cache on localhost/127.0.0.1 (registration is also
// gated behind import.meta.env.PROD in main.tsx). Self-unregister + wipe all
// caches so a stale dev registration can never serve outdated deps again.
const IS_DEV = /^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test(self.location.hostname);

if (IS_DEV) {
  self.addEventListener('install', (event) => {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        await self.skipWaiting();
      })()
    );
  });
  self.addEventListener('activate', (event) => {
    event.waitUntil(
      (async () => {
        await self.registration.unregister();
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach((c) => c.navigate(c.url));
        await self.clients.claim();
      })()
    );
  });
} else {
  const CACHE = 'privapdf-shell-v4';
  // Hanya file yang benar-benar ada di public/. Aset Office WASM belum
  // disertakan (lihat halaman Privacy) dan tidak boleh dicache — SPA rewrite
  // akan menyajikan index.html dengan status 200 untuk path yang hilang.
  const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];
  self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())));
  self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
  self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    const request = event.request;
    if (request.mode === 'navigate') {
      event.respondWith(fetch(request).catch(() => caches.match('/index.html')));
      return;
    }
    // Jangan cache respons HTML untuk request non-navigasi: SPA rewrite
    // menjawab 200 dengan index.html untuk path aset yang tidak ada, dan
    // mencachernya akan meracuni shell (HTML tersaji sebagai JS/WASM).
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      const isHtml = (response.headers.get('content-type') || '').includes('text/html');
      if (response.ok && !isHtml && new URL(request.url).origin === self.location.origin) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })));
  });
}

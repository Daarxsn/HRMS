const worker = globalThis as any;
const CACHE = 'falchion-shell-v3';
const APP_SHELL = ['/', '/manifest.webmanifest', '/pwa-icon.svg'];

worker.addEventListener('install', (event: any) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache: Cache) => cache.addAll(APP_SHELL))
      .then(() => worker.skipWaiting())
  );
});

worker.addEventListener('activate', (event: any) => {
  event.waitUntil(
    caches.keys()
      .then((keys: string[]) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => worker.clients.claim())
  );
});

worker.addEventListener('fetch', (event: any) => {
  const request = event.request as Request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response: Response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache: Cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response: Response) => {
          if (response.ok && url.origin === worker.location.origin) {
            const copy = response.clone();
            caches.open(CACHE).then((cache: Cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

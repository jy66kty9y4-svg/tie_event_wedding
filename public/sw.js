const CACHE = 'tie-shell-v2';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const index = await fetch('/index.html', { cache: 'no-cache' });
    if (!index.ok) throw new Error(`Shell returned ${index.status}`);
    const html = await index.text();
    await cache.put('/index.html', new Response(html, { status: 200, headers: index.headers }));
    await cache.put('/', new Response(html, { status: 200, headers: index.headers }));
    const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map(match => new URL(match[1], self.location.origin))
      .filter(url => url.origin === self.location.origin && !url.pathname.startsWith('/api/'))
      .map(url => url.pathname + url.search);
    const urls = [...new Set([...SHELL.slice(2), ...assets])];
    await Promise.all(urls.map(async url => {
      const response = await fetch(url, { cache: 'no-cache' });
      if (cacheable(new Request(new URL(url, self.location.origin)), response)) await cache.put(url, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('tie-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

function cacheable(request, response) {
  if (request.method !== 'GET' || !response || !response.ok || response.type === 'opaque') return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return false;
  const control = response.headers.get('cache-control') || '';
  return !/no-store|private/i.test(control);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (cacheable(request, response)) {
        const cache = await caches.open(CACHE);
        await cache.put(request.mode === 'navigate' ? '/' : request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request.mode === 'navigate' ? '/' : request);
      if (cached) return cached;
      throw error;
    }
  })());
});

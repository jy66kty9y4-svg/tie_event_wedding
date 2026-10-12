const CACHE = 'tie-shell-v11-icons';
const SHELL = [
  '/index.html', '/manifest.webmanifest', '/icon.svg',
  '/brand/tie/logo-dark.png', '/brand/tie/logo-light.png',
  '/brand/tie/signature-red.png', '/brand/tie/signature-light.png', '/brand/tie/event-pattern.png',
  '/brand/tie/icon-192.png', '/brand/tie/icon-512.png',
  '/brand/tie/logo-04-20261012-16.png', '/brand/tie/logo-04-20261012-32.png',
  '/brand/tie/logo-04-20261012-180.png', '/brand/tie/logo-04-20261012-192.png',
  '/brand/tie/logo-04-20261012-512.png', '/brand/tie/logo-04-20261012-maskable-512.png',
  '/apple-touch-icon.png', '/favicon.ico',
  '/brand/tie/favicon-tie-20261012.svg', '/brand/tie/favicon-tie-20261012-16.png', '/brand/tie/favicon-tie-20261012-32.png',
  '/brand/tie/fonts/evolventa-regular.woff', '/brand/tie/fonts/evolventa-bold.woff',
  '/brand/tie/fonts/evolventa-oblique.woff', '/brand/tie/fonts/evolventa-bold-oblique.woff', '/brand/tie/fonts/ardeco.woff'
];

function localAsset(value, base = self.location.origin) {
  try {
    const url = new URL(value, base);
    return url.origin === self.location.origin && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/w/') ? url.pathname + url.search : null;
  } catch { return null; }
}

function moduleImports(source, base) {
  const found = [];
  const patterns = [
    /(?:import|export)\s+(?:[^'";]*?\sfrom\s*)?["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const asset = localAsset(match[1], base);
      if (asset) found.push(asset);
    }
  }
  return found;
}

async function precache(cache, value, seen) {
  const asset = localAsset(value);
  if (!asset || seen.has(asset) || seen.size >= 128) return;
  seen.add(asset);
  const request = new Request(new URL(asset, self.location.origin), { cache: 'no-cache' });
  const response = await fetch(request);
  if (!cacheable(request, response)) return;
  const source = /(?:java|type)script/i.test(response.headers.get('content-type') || '') || /\.(?:m?js|jsx|ts|tsx)(?:\?|$)/i.test(asset)
    ? await response.clone().text() : null;
  await cache.put(asset, response);
  if (source !== null) {
    for (const dependency of moduleImports(source, new URL(asset, self.location.origin))) await precache(cache, dependency, seen);
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const index = await fetch('/index.html', { cache: 'no-cache' });
    if (!index.ok) throw new Error(`Shell returned ${index.status}`);
    const html = await index.text();
    await cache.put('/index.html', new Response(html, { status: 200, headers: index.headers }));
    const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match => localAsset(match[1])).filter(Boolean);
    const urls = [...new Set([...SHELL.slice(1), ...assets])];
    const seen = new Set(['/index.html']);
    for (const url of urls) await precache(cache, url, seen);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('tie-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

function cacheable(request, response) {
  if (request.method !== 'GET' || !response || !response.ok || response.type === 'opaque') return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/w/')) return false;
  const control = response.headers.get('cache-control') || '';
  return !/no-store|private/i.test(control);
}

function immutableAsset(url) {
  return url.pathname.startsWith('/assets/') && /-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|png|jpe?g|webp|svg)$/.test(url.pathname);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/w/')) return;
  if (request.mode === 'navigate' && !url.pathname.startsWith('/app') && !['/','/index.html'].includes(url.pathname)) return;
  event.respondWith((async () => {
    // A content hash changes with the file. Already downloaded application
    // modules can be served immediately, even when the connection is slow.
    if (immutableAsset(url) || SHELL.includes(url.pathname) && url.pathname.startsWith('/brand/tie/')) {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
    }
    try {
      const response = await fetch(request);
      if (cacheable(request, response) && !(request.mode === 'navigate' && url.pathname === '/')) {
        const cache = await caches.open(CACHE);
        await cache.put(request.mode === 'navigate' ? '/index.html' : request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request.mode === 'navigate' ? '/index.html' : request);
      if (cached) return cached;
      throw error;
    }
  })());
});

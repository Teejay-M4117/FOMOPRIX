const CACHE_NAME = 'ticketing-cache-v2';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/browserconfig.xml',
  '/offline.html'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

function isNavigationRequest(request){
  return request.mode === 'navigate' || (request.method === 'GET' && request.headers.get('accept')?.includes('text/html'));
}

self.addEventListener('fetch', event => {
  const req = event.request;

  // API requests: network-first, only cache GET requests
  if (req.url.includes('/api/')) {
    if (req.method === 'GET') {
      event.respondWith(
        fetch(req).then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          return res;
        }).catch(() => caches.match(req))
      );
    } else {
      // POST/PUT/DELETE: just network, don't cache
      event.respondWith(fetch(req));
    }
    return;
  }

  // Navigation requests: try network, fallback to offline page
  if (isNavigationRequest(req)) {
    event.respondWith(
      fetch(req).then(res => res).catch(() => caches.match('/offline.html'))
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(networkRes => {
      // cache fetched static assets (only GET)
      if (req.method === 'GET' && req.url.startsWith(self.location.origin)) {
        const copy = networkRes.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
      }
      return networkRes;
    }).catch(() => {
      // fallback for images or other resources
      if (req.destination === 'image') return new Response('', { status: 404 });
    }))
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

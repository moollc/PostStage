const CACHE = 'poststage-__CACHE_VERSION__';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/source/app/style.css',
  '/source/app/index.js',
  '/source/shared/permissions.js',
  '/source/shared/file-bridge.js',
  '/source/shared/store.js',
  '/source/shared/compress-still.js',
  '/source/shared/inbox-id.js',
  '/source/shared/score.js',
  '/source/shared/playbook.js',
  '/source/shared/platforms.js',
  '/source/shared/agent-bridge.js',
  '/source/assets/data/platforms.json',
  '/source/assets/images/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname === '/image') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request)),
  );
});

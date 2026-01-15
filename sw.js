// sw.js
const CACHE_NAME = 'keuangan-pwa-v2.0';
const APP_SHELL = [
  '',
  'keuangan.html',
  'manifest.json',
  'icon-192x192.png'
];

// Install event
self.addEventListener('install', (event) => {
  console.log('🔄 Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('📦 Caching app shell');
        return cache.addAll(APP_SHELL);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event
self.addEventListener('activate', (event) => {
  console.log('✅ Service Worker activated');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - Network First Strategy
self.addEventListener('fetch', (event) => {
  // Jangan sentuh request ke Apps Script
  if (event.request.url.includes('script.google.com')) return;

  // Skip non-GET
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});


// Background sync (opsional)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-transactions') {
    console.log('🔄 Background sync triggered');
    // Implement background sync logic here
  }
});

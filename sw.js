// sw.js
const CACHE_NAME = 'keuangan-pwa-v2.0';
const APP_SHELL = [
  '',
  'index.html',
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
  // Skip Google Sheets API
  if (event.request.url.includes('script.google.com')) {
    return fetch(event.request);
  }
  
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;
  
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Fallback to cache when offline
        return caches.match(event.request)
          .then((response) => {
            if (response) {
              return response;
            }
            // Return cached HTML for navigation requests
            if (event.request.mode === 'navigate') {
              return caches.match('index.html');
            }
          });
      })
  );
});

// Background sync (opsional)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-transactions') {
    console.log('🔄 Background sync triggered');
    // Implement background sync logic here
  }
});

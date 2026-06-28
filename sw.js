// Meetle Service Worker
// Caches the app shell for fast loading and basic offline support

const CACHE_NAME = 'meetle-v1';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './config.js',
  './icons/icon192.png',
  './icons/icon512.png',
  './pwa-manifest.json'
];

// Install — cache the app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// Activate — clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(key => key !== CACHE_NAME)
        .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch — cache-first for app shell, network-first for Google Maps API calls
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always go network-first for Google Maps API (live data)
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('gstatic.com')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Cache-first for app shell assets
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache new valid responses
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback — return cached index.html
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// Service worker: keeps the app shell on the phone so it opens fast and installs as an app.
// The page itself is always fetched fresh when there is internet; data goes straight to Firebase.
const VERSION = 'taller-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // The page: network first so updates show up right away; the saved copy when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put('./index.html', copy));
      return res;
    }).catch(() => caches.match('./index.html')));
    return;
  }

  // Icons, manifest, the pinned Firebase SDK and fonts never change for a given URL: serve the saved copy.
  const cacheable = url.origin === location.origin
    || (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'))
    || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!cacheable) return; // Firestore, sign-in and Wikipedia go straight to the network.
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  })));
});

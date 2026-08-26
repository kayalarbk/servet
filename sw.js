/* =====================================================================
   sw.js — Service Worker
   Uygulama kabuğu: cache-first (sürümlü)
   Dış API'ler   : network-first, başarısızsa son yanıt (stale) döner
   ===================================================================== */
const VERSION = 'servet-v2.4.0';
const SHELL = VERSION + '-shell';
const RUNTIME = VERSION + '-runtime';

const SHELL_FILES = [
  './',
  './index.html',
  './css/style.css?v=2.4.0',
  './js/lock.js?v=2.4.0',
  './js/symbols.js?v=2.4.0',
  './js/data.js?v=2.4.0',
  './js/store.js?v=2.4.0',
  './js/charts.js?v=2.4.0',
  './js/market.js?v=2.4.0',
  './js/qr.js?v=2.4.0',
  './js/transfer.js?v=2.4.0',
  './js/onboard.js?v=2.4.0',
  './js/app.js?v=2.4.0',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => c.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Dış veri kaynakları (kur, fiyat, banka listesi): önce ağ, sonra önbellek
  if (!sameOrigin) {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(RUNTIME).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Gezinme istekleri: uygulama kabuğuna düş
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Statik dosyalar: önce önbellek, arka planda tazele
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(SHELL).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});

// Sayfadan gelen "hemen güncelle" mesajı
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

// עבודה בלי אינטרנט: כל קבצי האפליקציה נשמרים בטלפון בפתיחה הראשונה.
// מגישים מהמטמון מיד, ובמקביל מעדכנים מהרשת לפעם הבאה.
// להעלות את VERSION בכל שינוי ברשימת הקבצים.
const VERSION = 'drills-v1';
const FILES = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/geometry.js', 'js/recognize.js', 'js/model.js', 'js/explain.js',
  'js/render.js', 'js/animate.js', 'js/storage.js', 'js/export.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('drills-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req)
        .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      return (await net) || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
    }),
  );
});

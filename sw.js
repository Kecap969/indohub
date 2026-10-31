// Service worker Indohub: membuat situs bisa dipasang sebagai aplikasi.
// Aturan: API, video/audio, dan file lintas-situs TIDAK pernah disentuh. Data selalu langsung dari server.
const VERSION = "v1"; // naikkan angka ini jika ingin memaksa cache lama dibuang
const CACHE = "indohub-static-" + VERSION;
const PRECACHE = ["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("indohub-static-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok) { const c = await caches.open(CACHE); c.put(req, res.clone()); }
    return res;
  } catch (err) {
    const hit = await caches.match(req);
    if (hit) return hit;
    throw err;
  }
}
async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) { const c = await caches.open(CACHE); c.put(req, res.clone()); }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;       // video/audio memakai Range: biarkan
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                    // R2, Google Fonts, dll: biarkan
  if (url.pathname.startsWith("/api/")) return;                       // data selalu dari server

  if (req.mode === "navigate") {                                      // buka halaman: online = normal, offline = halaman info
    e.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
    return;
  }
  if (url.pathname.startsWith("/icons/")) { e.respondWith(cacheFirst(req)); return; }
  if (/\.(css|js)$/.test(url.pathname)) { e.respondWith(networkFirst(req)); return; }
});

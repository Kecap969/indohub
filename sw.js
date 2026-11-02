// Service worker Indohub: membuat situs bisa dipasang sebagai aplikasi.
// Aturan: API, video/audio, dan file lintas-situs TIDAK pernah disentuh. Data selalu langsung dari server.
const VERSION = "v1"; // naikkan angka ini jika ingin memaksa cache lama dibuang
const CACHE = "indohub-static-" + VERSION;
const PRECACHE = ["/icons/icon-192.png", "/icons/icon-512.png"];
// Halaman "tidak ada koneksi" ditulis langsung di sini (tidak perlu file terpisah)
const OFFLINE_HTML = "<!DOCTYPE html>\n<html lang=\"id\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<meta name=\"theme-color\" content=\"#062d4e\">\n<title>Tidak ada koneksi · Indohub</title>\n<style>\n  html,body{height:100%;margin:0}\n  body{display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;box-sizing:border-box;\n    background:radial-gradient(120% 90% at 50% 0%,#0a3a63 0%,#05102c 70%);color:#fff;\n    font-family:system-ui,-apple-system,\"Segoe UI\",Roboto,sans-serif}\n  img{width:96px;height:96px;border-radius:22px;box-shadow:0 10px 30px rgba(0,0,0,.4)}\n  h1{font-size:1.35rem;margin:18px 0 6px}\n  p{margin:0 0 22px;color:#b9c7da;line-height:1.5;max-width:300px}\n  button{border:0;border-radius:999px;padding:12px 28px;font-size:1rem;font-weight:600;color:#fff;background:#e11d2e;cursor:pointer}\n</style>\n</head>\n<body>\n  <main>\n    <img src=\"/icons/icon-192.png\" alt=\"Indohub\">\n    <h1>Tidak ada koneksi</h1>\n    <p>Periksa internet Anda, lalu coba lagi untuk melanjutkan menonton.</p>\n    <button type=\"button\" onclick=\"location.reload()\">Coba lagi</button>\n  </main>\n</body>\n</html>";
const offlineResponse = () => new Response(OFFLINE_HTML, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });

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
    e.respondWith(fetch(req).catch(offlineResponse));
    return;
  }
  if (url.pathname.startsWith("/icons/")) { e.respondWith(cacheFirst(req)); return; }
  if (/\.(css|js)$/.test(url.pathname)) { e.respondWith(networkFirst(req)); return; }
});

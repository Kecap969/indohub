// Server utama (Express): rute halaman + API. Modul pendukung: lib.js (config, sesi, data, penyimpanan)
// Berjalan di Vercel (zero-config Express) maupun lokal: `node server.js`
const express = require("express");
const fs = require("fs");
const path = require("path");
const { PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectsCommand, CopyObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const {
  SITE, ADMIN_USER, makeAdminToken, makeUserToken, readToken, isAdminToken, needAdmin, needUser,
  checkLogin, hashPw, checkPw, dbMissing, db,
  missingEnv, client: r2, bucket, VIDEO, AUDIO,
} = require("./lib");

const NAME_RE = /^[A-Za-z0-9_-]{2,30}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMG_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_IMG = 5 * 1024 * 1024;
const LINK_TTL = 6 * 3600; // link putar berlaku 6 jam
const QRIS_KEY = "payment/qris.jpg";

// Nama album jadi nama folder: hanya huruf, angka, spasi, - dan _
const cleanAlbum = (v) => String(v || "").replace(/[^\p{L}\p{N} _-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = encodeURIComponent;
// Konfigurasi belum lengkap: pengguna biasa hanya melihat pesan umum (tanpa nama layanan/variabel).
// Detail variabel yang kurang hanya ditulis ke log server dan ditampilkan ke admin yang sudah login.
const notReady = (req, res, miss) => {
  console.error("Konfigurasi belum lengkap:", miss.join(", "));
  const admin = isAdminToken(readToken(req));
  return res.status(503).json({ error: admin ? "Konfigurasi server belum lengkap: " + miss.join(", ") : "Layanan sedang tidak tersedia, coba lagi nanti" });
};
const needR2 = (req, res, next) => { const miss = missingEnv(); return miss.length ? notReady(req, res, miss) : next(); };
const needDb = (req, res, next) => { const miss = dbMissing(); return miss.length ? notReady(req, res, miss) : next(); };
const signGet = (key, secs) => getSignedUrl(r2(), new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn: secs || LINK_TTL });
const exists = async (key) => {
  try { await r2().send(new HeadObjectCommand({ Bucket: bucket(), Key: key })); return true; } catch (e) { return false; }
};
const fail = (res, e, msg) => res.status(500).json({ error: msg || "Terjadi kesalahan di server" });

/* ---------- data pengguna ---------- */
async function premiumUntil(u) {
  const rows = await db("GET", `ih_subscriptions?username_lc=eq.${enc(u)}&select=expires_at`);
  const d = rows[0] && rows[0].expires_at;
  return d && new Date(d) > new Date() ? d : null;
}
async function meInfo(u) {
  const [users, until, pend] = await Promise.all([
    db("GET", `ih_users?username_lc=eq.${enc(u)}&select=username,pass_hash`),
    premiumUntil(u),
    db("GET", `ih_payments?username_lc=eq.${enc(u)}&status=eq.pending&select=id,months,amount,created_at&order=created_at.desc&limit=1`),
  ]);
  if (!users[0]) return null;
  const p = pend[0];
  return {
    username: users[0].username, hasPassword: !!users[0].pass_hash, premiumUntil: until,
    pending: p ? { id: p.id, months: p.months, amount: p.amount, createdAt: p.created_at } : null,
  };
}
const notify = (u, title, body) => db("POST", "ih_notifications", { username_lc: u, title, body }, "return=minimal");

/* ---------- app ---------- */
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// Halaman tunggal
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const page = read("index.html");
const css = read("style.css");
const js = read("app.js");
const adminPage = read("admin.html");
const adminJs = read("admin.js");
app.get("/", (req, res) => res.type("html").send(page));
app.get("/style.css", (req, res) => res.type("css").send(css));
app.get("/app.js", (req, res) => res.type("js").send(js));
app.get("/admin.js", (req, res) => res.type("js").send(adminJs));
// Dashboard admin: halaman terpisah. Login tetap di "/", API admin tetap dicek token di server.
app.get(["/admin", "/admin/", "/admin.html"], (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.type("html").send(adminPage);
});

app.get("/api/config", (req, res) => res.json({ ...SITE, adminUser: ADMIN_USER }));

/* ---------- login ---------- */
app.post("/api/login", async (req, res) => { // admin
  if (!process.env.ADMIN_PASSWORD) { console.error("ADMIN_PASSWORD belum diisi"); return res.status(503).json({ error: "Layanan sedang tidak tersedia, coba lagi nanti" }); }
  const { username, password } = req.body || {};
  if (!checkLogin(username, password)) {
    await wait(1000);
    return res.status(401).json({ error: "Username atau password salah" });
  }
  res.json({ token: makeAdminToken() });
});
app.get("/api/me", needAdmin, (req, res) => res.json({ ok: true }));

// User biasa: username saja; kalau akun sudah punya password, password wajib
app.post("/api/enter", needDb, async (req, res) => {
  const name = String((req.body || {}).username || "").trim();
  const password = (req.body || {}).password;
  if (!NAME_RE.test(name)) return res.status(400).json({ error: "Username harus 2-30 karakter: huruf, angka, _ atau -" });
  const u = name.toLowerCase();
  if (u === ADMIN_USER) return res.status(400).json({ error: "Username ini dicadangkan" });
  try {
    let rows = await db("GET", `ih_users?username_lc=eq.${enc(u)}&select=username,pass_hash`);
    if (!rows[0]) {
      try { await db("POST", "ih_users", { username_lc: u, username: name }, "return=minimal"); } catch (e) { /* balapan: sudah dibuat */ }
      rows = await db("GET", `ih_users?username_lc=eq.${enc(u)}&select=username,pass_hash`);
    }
    if (rows[0].pass_hash) {
      if (!password) return res.status(401).json({ error: "Akun ini memakai password", needPassword: true });
      if (!(await checkPw(password, rows[0].pass_hash))) {
        await wait(1000);
        return res.status(401).json({ error: "Password salah", needPassword: true });
      }
    }
    res.json({ token: makeUserToken(u), me: await meInfo(u) });
  } catch (e) { fail(res, e, "Gagal masuk"); }
});

app.get("/api/session", needUser, needDb, async (req, res) => {
  try {
    const me = await meInfo(req.user);
    me ? res.json({ me }) : res.status(401).json({ error: "Akun tidak ditemukan" });
  } catch (e) { fail(res, e); }
});

app.post("/api/password", needUser, needDb, async (req, res) => {
  const { password, current } = req.body || {};
  if (typeof password !== "string" || password.length < 6 || password.length > 100)
    return res.status(400).json({ error: "Password minimal 6 karakter" });
  try {
    const rows = await db("GET", `ih_users?username_lc=eq.${enc(req.user)}&select=pass_hash`);
    if (!rows[0]) return res.status(401).json({ error: "Akun tidak ditemukan" });
    if (rows[0].pass_hash && !(await checkPw(current || "", rows[0].pass_hash))) {
      await wait(1000);
      return res.status(403).json({ error: "Password saat ini salah" });
    }
    await db("PATCH", `ih_users?username_lc=eq.${enc(req.user)}`, { pass_hash: await hashPw(password) }, "return=minimal");
    res.json({ ok: true });
  } catch (e) { fail(res, e, "Gagal menyimpan password"); }
});

app.get("/api/notifs", needUser, needDb, async (req, res) => {
  try {
    res.json({ items: await db("GET", `ih_notifications?or=(username_lc.eq.${enc(req.user)},username_lc.is.null)&select=id,title,body,created_at&order=created_at.desc&limit=20`) });
  } catch (e) { fail(res, e); }
});

/* ---------- daftar media ---------- */
// Struktur bucket: free/<album>/<ts>-<file>, premium/<album>/<ts>-<file>
// File lama di uploads/<user>/... ditampilkan sebagai album "Lainnya" (gratis).
const LEGACY_ALBUM = "Lainnya";
const prettyTitle = (f) => f.replace(/^\d+-/, "").replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || f;

async function listPrefix(prefix) {
  const all = [];
  let token;
  for (let i = 0; i < 5; i++) { // maks 5 x 1000 file per folder
    const out = await r2().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, MaxKeys: 1000, ContinuationToken: token }));
    all.push(...(out.Contents || []));
    if (!out.IsTruncated) break;
    token = out.NextContinuationToken;
  }
  return all;
}

app.get("/api/list", needR2, async (req, res) => {
  try {
    const t = readToken(req);
    let member = isAdminToken(t);
    if (!member && t && t.k === "user") member = !!(await premiumUntil(t.u));

    const lists = await Promise.all(["free/", "premium/", "uploads/"].map(listPrefix));
    const thumbKeys = new Set((await listPrefix("thumbs/")).map((o) => o.Key));
    const items = lists.flat()
      .filter((o) => VIDEO.test(o.Key) || AUDIO.test(o.Key))
      .map((o) => {
        const parts = o.Key.split("/");
        const legacy = parts[0] === "uploads";
        if (!legacy && parts.length < 3) return null; // harus free|premium/<album>/<file>
        return {
          key: o.Key,
          category: legacy ? "free" : parts[0],
          album: legacy ? LEGACY_ALBUM : parts[1],
          title: prettyTitle(parts[parts.length - 1]),
          size: o.Size,
          lastModified: o.LastModified,
          type: AUDIO.test(o.Key) ? "audio" : "video",
        };
      })
      .filter(Boolean)
      .sort((x, y) => new Date(y.lastModified) - new Date(x.lastModified));

    // Tayangan, like, dan komentar per video (gagal memuat statistik tidak boleh menggagalkan daftar)
    const stats = new Map();
    if (!dbMissing().length) {
      try {
        const rows = await db("POST", "rpc/ih_media_stats", { uname: t && t.k === "user" ? t.u : null });
        (rows || []).forEach((r) => stats.set(r.video_key, r));
      } catch (e) { console.error("Statistik media gagal dimuat:", e.message); }
    }
    items.forEach((it) => {
      const s = stats.get(it.key) || {};
      it.views = Number(s.views) || 0;
      it.likes = Number(s.likes) || 0;
      it.comments = Number(s.comments) || 0;
      it.liked = !!s.liked;
    });

    // Premium hanya diberi link kalau member aktif (atau admin); yang lain hanya melihat daftar terkunci
    await Promise.all(items.map(async (it) => {
      if (it.category === "premium" && !member) {
        it.locked = true; // link video TIDAK diberikan; hanya thumbnail (gambar) kalau ada
        const tk = `thumbs/${it.key}.jpg`;
        if (thumbKeys.has(tk)) it.thumb = await signGet(tk);
      } else it.url = await signGet(it.key);
    }));
    res.setHeader("Cache-Control", "no-store");
    res.json({ items, premium: member });
  } catch (e) {
    res.status(500).json({ error: "Gagal memuat daftar media" });
  }
});

/* ---------- interaksi: tayangan, like, komentar ---------- */
const MEDIA_KEY_RE = /^(free|premium|uploads)\/[^/].*$/;
const validMediaKey = (k) =>
  typeof k === "string" && k.length <= 300 && MEDIA_KEY_RE.test(k) && !k.includes("..") && (VIDEO.test(k) || AUDIO.test(k));
// Pastikan video valid, ada di penyimpanan, dan (kalau premium) pengguna adalah member aktif
async function mediaGate(req, res) {
  const key = String((req.body && req.body.key) || req.query.key || "");
  if (!validMediaKey(key)) { res.status(400).json({ error: "Video tidak valid" }); return null; }
  if (key.startsWith("premium/") && !(await premiumUntil(req.user))) {
    res.status(403).json({ error: "Khusus member premium" }); return null;
  }
  if (!(await exists(key))) { res.status(404).json({ error: "Video tidak ditemukan" }); return null; }
  return key;
}
const commentRows = (key) =>
  db("GET", `ih_comments?video_key=eq.${enc(key)}&select=id,body,created_at,username_lc,ih_users(username)&order=created_at.desc&limit=100`);
const commentOut = (c, me) => ({
  id: c.id, body: c.body, createdAt: c.created_at,
  username: (c.ih_users && c.ih_users.username) || c.username_lc,
  mine: !!me && c.username_lc === me,
});

app.post("/api/media/view", needUser, needDb, needR2, async (req, res) => {
  try {
    const key = await mediaGate(req, res); if (!key) return;
    const n = await db("POST", "rpc/ih_record_view", { k: key, u: req.user });
    res.json({ views: Number(n) || 0 });
  } catch (e) { fail(res, e, "Gagal mencatat tayangan"); }
});

app.post("/api/media/like", needUser, needDb, needR2, async (req, res) => {
  try {
    const key = await mediaGate(req, res); if (!key) return;
    const r = ((await db("POST", "rpc/ih_toggle_like", { k: key, u: req.user })) || [])[0] || {};
    res.json({ liked: !!r.is_liked, likes: Number(r.like_count) || 0 });
  } catch (e) { fail(res, e, "Gagal memproses like"); }
});

app.get("/api/media/comments", needUser, needDb, needR2, async (req, res) => {
  try {
    const key = await mediaGate(req, res); if (!key) return;
    const rows = await commentRows(key);
    res.setHeader("Cache-Control", "no-store");
    res.json({ items: rows.map((c) => commentOut(c, req.user)) });
  } catch (e) { fail(res, e, "Gagal memuat komentar"); }
});

app.post("/api/media/comment", needUser, needDb, needR2, async (req, res) => {
  const body = String((req.body || {}).body || "").replace(/\s+/g, " ").trim();
  if (!body) return res.status(400).json({ error: "Komentar tidak boleh kosong" });
  if (body.length > 300) return res.status(400).json({ error: "Komentar maksimal 300 karakter" });
  try {
    const key = await mediaGate(req, res); if (!key) return;
    // batas kirim: maksimal 5 komentar per menit per pengguna
    const since = new Date(Date.now() - 60000).toISOString();
    const recent = await db("GET", `ih_comments?username_lc=eq.${enc(req.user)}&created_at=gte.${enc(since)}&select=id`);
    if (recent.length >= 5) return res.status(429).json({ error: "Terlalu cepat, tunggu sebentar lalu coba lagi" });
    const row = (await db("POST", "ih_comments", { video_key: key, username_lc: req.user, body }))[0];
    const u = (await db("GET", `ih_users?username_lc=eq.${enc(req.user)}&select=username`))[0];
    res.json({ comment: { id: row.id, body: row.body, createdAt: row.created_at, username: (u && u.username) || req.user, mine: true } });
  } catch (e) { fail(res, e, "Gagal mengirim komentar"); }
});

// pengguna hanya boleh menghapus komentarnya sendiri
app.post("/api/media/comment/:id/delete", needUser, needDb, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "ID tidak valid" });
  try {
    const rows = await db("DELETE", `ih_comments?id=eq.${req.params.id}&username_lc=eq.${enc(req.user)}&select=id`);
    if (!rows || !rows.length) return res.status(404).json({ error: "Komentar tidak ditemukan" });
    res.json({ ok: true });
  } catch (e) { fail(res, e, "Gagal menghapus komentar"); }
});

// moderasi admin: lihat & hapus komentar siapa pun
app.get("/api/admin/comments", needAdmin, needDb, async (req, res) => {
  const key = String(req.query.key || "");
  if (!validMediaKey(key)) return res.status(400).json({ error: "Video tidak valid" });
  try {
    const rows = await commentRows(key);
    res.setHeader("Cache-Control", "no-store");
    res.json({ items: rows.map((c) => commentOut(c, null)) });
  } catch (e) { fail(res, e, "Gagal memuat komentar"); }
});
app.post("/api/admin/comments/:id/delete", needAdmin, needDb, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "ID tidak valid" });
  try {
    const rows = await db("DELETE", `ih_comments?id=eq.${req.params.id}&select=id`);
    if (!rows || !rows.length) return res.status(404).json({ error: "Komentar tidak ditemukan" });
    res.json({ ok: true });
  } catch (e) { fail(res, e, "Gagal menghapus komentar"); }
});

/* ---------- admin: upload & hapus media ---------- */
app.post("/api/presign", needAdmin, needR2, async (req, res) => {
  const { category, album, filename, contentType, size } = req.body || {};
  if (category !== "free" && category !== "premium")
    return res.status(400).json({ error: "Pilih kategori Gratis atau Premium" });
  const albumName = cleanAlbum(album);
  if (albumName.length < 2) return res.status(400).json({ error: "Nama album minimal 2 karakter (huruf, angka, spasi, - atau _)" });
  if (!/^(video|audio)\//.test(contentType || ""))
    return res.status(400).json({ error: "Hanya file video atau audio yang boleh diupload" });
  if (!filename || typeof filename !== "string") return res.status(400).json({ error: "Nama file kosong" });
  if (!size || size > SITE.maxUploadMB * 1024 * 1024)
    return res.status(400).json({ error: `Ukuran file maksimal ${SITE.maxUploadMB} MB` });

  const safeName = filename.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-80) || "file";
  const key = `${category}/${albumName}/${Date.now()}-${safeName}`;
  try {
    const uploadUrl = await getSignedUrl(r2(), new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }), { expiresIn: 900 });
    res.json({ uploadUrl, key, album: albumName });
  } catch (e) {
    res.status(500).json({ error: "Gagal membuat URL upload" });
  }
});

// thumbnail video disimpan terpisah di thumbs/<key-video>.jpg supaya video premium tetap tidak bocor
app.post("/api/presign-thumb", needAdmin, needR2, async (req, res) => {
  const key = (req.body && req.body.key) || "";
  if (typeof key !== "string" || !/^(free|premium)\/[^/]+\/[^/]+$/.test(key) || key.includes("..") || !VIDEO.test(key))
    return res.status(400).json({ error: "Key video tidak valid" });
  try {
    const uploadUrl = await getSignedUrl(r2(), new PutObjectCommand({ Bucket: bucket(), Key: `thumbs/${key}.jpg`, ContentType: "image/jpeg" }), { expiresIn: 900 });
    res.json({ uploadUrl });
  } catch (e) {
    res.status(500).json({ error: "Gagal membuat URL thumbnail" });
  }
});

app.post("/api/delete", needAdmin, needR2, async (req, res) => {
  const keys = (req.body && req.body.keys) || [];
  if (!Array.isArray(keys) || !keys.length || keys.length > 1000)
    return res.status(400).json({ error: "Daftar file tidak valid" });
  if (!keys.every((k) => typeof k === "string" && /^(free|premium|uploads)\//.test(k) && !k.includes("..")))
    return res.status(400).json({ error: "Hanya file di folder free/, premium/ atau uploads/ yang boleh dihapus" });
  try {
    const all = keys.concat(keys.filter((k) => !k.startsWith("uploads/")).map((k) => `thumbs/${k}.jpg`));
    for (let i = 0; i < all.length; i += 1000)
      await r2().send(new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: all.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true } }));
    if (!dbMissing().length) { // hapus juga like, komentar, tayangan milik video ini
      try { await db("POST", "rpc/ih_drop_media", { keys }); } catch (e) { console.error("Gagal membersihkan data interaksi:", e.message); }
    }
    res.json({ deleted: keys.length });
  } catch (e) {
    res.status(500).json({ error: "Gagal menghapus file" });
  }
});

// Pindahkan file antar kategori/album (R2 tidak punya "move": salin dulu, lalu hapus yang lama; thumbnail ikut)
const copyObj = (from, to) => r2().send(new CopyObjectCommand({
  Bucket: bucket(), Key: to, CopySource: `${bucket()}/${from.split("/").map(enc).join("/")}`, MetadataDirective: "COPY",
}));
app.post("/api/move", needAdmin, needR2, async (req, res) => {
  const { keys, category, album } = req.body || {};
  if (!Array.isArray(keys) || !keys.length || keys.length > 200)
    return res.status(400).json({ error: "Daftar file tidak valid (maksimal 200 sekaligus)" });
  if (!keys.every((k) => typeof k === "string" && /^(free|premium|uploads)\/.+/.test(k) && !k.includes("..") && (VIDEO.test(k) || AUDIO.test(k))))
    return res.status(400).json({ error: "Hanya file media di folder free/, premium/ atau uploads/ yang bisa dipindahkan" });
  if (category !== "free" && category !== "premium") return res.status(400).json({ error: "Pilih tujuan Gratis atau Premium" });
  const albumName = category === "free" ? "Umum" : cleanAlbum(album);
  if (albumName.length < 2) return res.status(400).json({ error: "Nama album minimal 2 karakter (huruf, angka, spasi, - atau _)" });

  const moves = [...new Set(keys)].map((k) => ({ from: k, to: `${category}/${albumName}/${k.split("/").pop()}` })).filter((m) => m.from !== m.to);
  if (!moves.length) return res.json({ moved: 0 });
  const done = [];
  let err = null;
  try {
    for (let i = 0; i < moves.length; i += 5) {
      await Promise.all(moves.slice(i, i + 5).map(async (m) => {
        await copyObj(m.from, m.to);
        m.thumb = false;
        if (!m.from.startsWith("uploads/") && (await exists(`thumbs/${m.from}.jpg`))) {
          try { await copyObj(`thumbs/${m.from}.jpg`, `thumbs/${m.to}.jpg`); m.thumb = true; } catch (e) { /* thumbnail lama dibiarkan */ }
        }
        done.push(m);
      }));
    }
  } catch (e) { err = e; }
  if (done.length && !dbMissing().length) { // like, komentar, tayangan ikut ke key baru
    try { await db("POST", "rpc/ih_move_media", { moves: done.map((m) => ({ from: m.from, to: m.to })) }); }
    catch (e) { console.error("Gagal memindahkan data interaksi:", e.message); }
  }
  try {
    // hapus hanya file asal yang sudah berhasil disalin
    const del = done.flatMap((m) => [m.from, ...(m.thumb ? [`thumbs/${m.from}.jpg`] : [])]);
    for (let i = 0; i < del.length; i += 1000)
      await r2().send(new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: del.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true } }));
  } catch (e) { err = err || e; }
  if (err) return res.status(500).json({ error: `Hanya ${done.length} dari ${moves.length} file yang berhasil dipindahkan. Coba lagi.` });
  res.json({ moved: done.length });
});

/* ---------- pembayaran: sisi user ---------- */
app.get("/api/payment/info", needUser, needR2, async (req, res) => {
  try {
    res.json({ price: SITE.pricePerMonth, qris: (await exists(QRIS_KEY)) ? await signGet(QRIS_KEY, 3600) : null });
  } catch (e) { fail(res, e); }
});

// Buat/ubah tagihan (status "waiting") dengan kode unik supaya mudah dicocokkan admin
app.post("/api/payment/start", needUser, needDb, async (req, res) => {
  const months = Number((req.body || {}).months);
  if (!SITE.plans[months]) return res.status(400).json({ error: "Durasi tidak valid" });
  try {
    const me = await meInfo(req.user);
    if (!me) return res.status(401).json({ error: "Akun tidak ditemukan" });
    if (!me.hasPassword) return res.status(403).json({ error: "Buat password dulu sebelum berlangganan", needPassword: true });

    const open = await db("GET", "ih_payments?status=in.(waiting,pending)&select=username_lc,status,unique_code");
    if (open.filter((p) => p.username_lc === req.user && p.status === "pending").length >= 3)
      return res.status(429).json({ error: "Masih ada bukti yang menunggu persetujuan admin" });

    const mine = (await db("GET", `ih_payments?username_lc=eq.${enc(req.user)}&status=eq.waiting&select=id,unique_code&limit=1`))[0];
    let code = mine ? mine.unique_code : 0;
    if (!code) {
      const used = new Set(open.map((p) => p.unique_code));
      for (let i = 0; i < 200 && (!code || used.has(code)); i++) code = 1 + Math.floor(Math.random() * (i < 100 ? 99 : 999));
    }
    const amount = SITE.plans[months] + code;
    const row = mine
      ? (await db("PATCH", `ih_payments?id=eq.${mine.id}`, { months, amount }))[0]
      : (await db("POST", "ih_payments", { username_lc: req.user, months, amount, unique_code: code }))[0];
    res.json({ id: row.id, months, amount, code });
  } catch (e) { fail(res, e, "Gagal membuat tagihan"); }
});

async function ownWaiting(req) {
  if (!UUID_RE.test(req.params.id)) return null;
  const rows = await db("GET", `ih_payments?id=eq.${req.params.id}&username_lc=eq.${enc(req.user)}&status=eq.waiting&select=id,proof_key`);
  return rows[0] || null;
}
app.post("/api/payment/:id/presign", needUser, needDb, needR2, async (req, res) => {
  const { contentType, size } = req.body || {};
  const ext = IMG_EXT[contentType];
  if (!ext) return res.status(400).json({ error: "Bukti harus berupa gambar (JPG, PNG, atau WebP)" });
  if (!size || size > MAX_IMG) return res.status(400).json({ error: "Ukuran gambar maksimal 5 MB" });
  try {
    const p = await ownWaiting(req);
    if (!p) return res.status(404).json({ error: "Tagihan tidak ditemukan, buka ulang halaman berlangganan" });
    const key = `payment/bukti/${p.id}.${ext}`;
    await db("PATCH", `ih_payments?id=eq.${p.id}`, { proof_key: key }, "return=minimal");
    const uploadUrl = await getSignedUrl(r2(), new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }), { expiresIn: 900 });
    res.json({ uploadUrl });
  } catch (e) { fail(res, e, "Gagal membuat URL upload"); }
});
app.post("/api/payment/:id/submit", needUser, needDb, needR2, async (req, res) => {
  try {
    const p = await ownWaiting(req);
    if (!p || !p.proof_key || !(await exists(p.proof_key))) return res.status(400).json({ error: "Bukti belum terupload" });
    await db("PATCH", `ih_payments?id=eq.${p.id}`, { status: "pending" }, "return=minimal");
    res.json({ ok: true });
  } catch (e) { fail(res, e, "Gagal mengirim bukti"); }
});

// detail pembayaran yang sedang menunggu verifikasi (termasuk foto bukti milik user itu sendiri)
app.get("/api/payment/pending", needUser, needDb, needR2, async (req, res) => {
  try {
    const rows = await db("GET", `ih_payments?username_lc=eq.${enc(req.user)}&status=eq.pending&select=id,months,amount,proof_key,created_at&order=created_at.desc&limit=1`);
    const p = rows[0];
    if (!p) return res.json({ payment: null });
    res.setHeader("Cache-Control", "no-store");
    res.json({ payment: {
      id: p.id, months: p.months, amount: p.amount, createdAt: p.created_at,
      proofUrl: p.proof_key ? await signGet(p.proof_key, 3600) : null,
    } });
  } catch (e) { fail(res, e, "Gagal memuat detail pembayaran"); }
});

/* ---------- pembayaran: sisi admin ---------- */
app.post("/api/payment/qris-presign", needAdmin, needR2, async (req, res) => {
  const { contentType, size } = req.body || {};
  if (!IMG_EXT[contentType]) return res.status(400).json({ error: "QRIS harus berupa gambar (JPG, PNG, atau WebP)" });
  if (!size || size > MAX_IMG) return res.status(400).json({ error: "Ukuran gambar maksimal 5 MB" });
  try {
    // selalu disimpan sebagai payment/qris.jpg (menimpa yang lama)
    const uploadUrl = await getSignedUrl(r2(), new PutObjectCommand({ Bucket: bucket(), Key: QRIS_KEY, ContentType: contentType }), { expiresIn: 900 });
    res.json({ uploadUrl });
  } catch (e) { fail(res, e, "Gagal membuat URL upload"); }
});

app.get("/api/admin/overview", needAdmin, needDb, needR2, async (req, res) => {
  try {
    const [pays, users, subs, hasQris] = await Promise.all([
      db("GET", "ih_payments?status=in.(pending,approved,rejected)&select=id,username_lc,months,amount,proof_key,status,reason,created_at,decided_at&order=created_at.desc&limit=50"),
      db("GET", "ih_users?select=username_lc,username,pass_hash,created_at&order=created_at.desc&limit=300"),
      db("GET", "ih_subscriptions?select=username_lc,expires_at"),
      exists(QRIS_KEY),
    ]);
    const names = new Map(users.map((u) => [u.username_lc, u.username]));
    const until = new Map(subs.map((s) => [s.username_lc, s.expires_at]));
    const payments = await Promise.all(pays.map(async (p) => ({
      id: p.id, username: names.get(p.username_lc) || p.username_lc, months: p.months, amount: p.amount,
      status: p.status, reason: p.reason, createdAt: p.created_at,
      proofUrl: p.proof_key ? await signGet(p.proof_key, 3600) : null,
    })));
    res.json({
      price: SITE.pricePerMonth,
      plans: SITE.plans,
      qris: hasQris ? await signGet(QRIS_KEY, 3600) : null,
      payments,
      users: users.map((u) => ({ username: u.username, key: u.username_lc, hasPassword: !!u.pass_hash, premiumUntil: until.get(u.username_lc) || null })),
    });
  } catch (e) { fail(res, e, "Gagal memuat data pembayaran"); }
});

app.post("/api/admin/payments/:id/approve", needAdmin, needDb, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "ID tidak valid" });
  try {
    const p = (await db("GET", `ih_payments?id=eq.${req.params.id}&select=id,username_lc,months,status`))[0];
    if (!p || p.status !== "pending") return res.status(400).json({ error: "Pembayaran ini sudah diproses atau belum dikirim" });
    const months = SITE.plans[Number((req.body || {}).months)] ? Number(req.body.months) : p.months;
    // perpanjang dari tanggal berakhir kalau masih aktif, selain itu dari sekarang
    const cur = (await db("GET", `ih_subscriptions?username_lc=eq.${enc(p.username_lc)}&select=expires_at`))[0];
    const base = cur && new Date(cur.expires_at) > new Date() ? new Date(cur.expires_at) : new Date();
    const exp = new Date(base);
    exp.setUTCMonth(exp.getUTCMonth() + months);
    await db("POST", "ih_subscriptions?on_conflict=username_lc", { username_lc: p.username_lc, expires_at: exp.toISOString() }, "resolution=merge-duplicates,return=minimal");
    await db("PATCH", `ih_payments?id=eq.${p.id}`, { status: "approved", months, decided_at: new Date().toISOString() }, "return=minimal");
    await notify(p.username_lc, "Pembayaran disetujui", `Premium aktif sampai ${exp.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}.`);
    res.json({ ok: true, expiresAt: exp.toISOString() });
  } catch (e) { fail(res, e, "Gagal menyetujui"); }
});

app.post("/api/admin/payments/:id/reject", needAdmin, needDb, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "ID tidak valid" });
  const reason = String((req.body || {}).reason || "").trim().slice(0, 200);
  try {
    const p = (await db("GET", `ih_payments?id=eq.${req.params.id}&select=id,username_lc,status`))[0];
    if (!p || p.status !== "pending") return res.status(400).json({ error: "Pembayaran ini sudah diproses atau belum dikirim" });
    await db("PATCH", `ih_payments?id=eq.${p.id}`, { status: "rejected", reason: reason || null, decided_at: new Date().toISOString() }, "return=minimal");
    await notify(p.username_lc, "Pembayaran ditolak", reason || "Bukti transfer tidak sesuai. Silakan kirim ulang.");
    res.json({ ok: true });
  } catch (e) { fail(res, e, "Gagal menolak"); }
});

// Kirim notifikasi dari dashboard: to = "all" (semua pengguna) atau username tertentu
app.post("/api/admin/notify", needAdmin, needDb, async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || "").trim().slice(0, 80);
  const body = String(b.body || "").trim().slice(0, 300);
  const to = String(b.to || "all").trim().toLowerCase();
  if (!title) return res.status(400).json({ error: "Judul notifikasi wajib diisi" });
  try {
    if (to === "all") {
      await db("POST", "ih_notifications", { username_lc: null, title, body: body || null }, "return=minimal");
      return res.json({ ok: true, to: "all" });
    }
    if (!NAME_RE.test(to)) return res.status(400).json({ error: "Username tidak valid" });
    const u = await db("GET", `ih_users?username_lc=eq.${enc(to)}&select=username_lc`);
    if (!u[0]) return res.status(404).json({ error: "Pengguna tidak ditemukan" });
    await notify(to, title, body || null);
    res.json({ ok: true, to });
  } catch (e) { fail(res, e, "Gagal mengirim notifikasi"); }
});

app.post("/api/admin/users/:u/clear-password", needAdmin, needDb, async (req, res) => {
  const u = String(req.params.u || "").toLowerCase();
  if (!NAME_RE.test(u)) return res.status(400).json({ error: "Username tidak valid" });
  try {
    await db("PATCH", `ih_users?username_lc=eq.${enc(u)}`, { pass_hash: null }, "return=minimal");
    res.json({ ok: true });
  } catch (e) { fail(res, e, "Gagal menghapus password"); }
});

// Semua alamat lain → halaman utama
app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Tidak ditemukan" });
  res.type("html").send(page);
});

module.exports = app;
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log("http://localhost:" + port));
}

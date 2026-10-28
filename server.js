// Server utama (Express): rute halaman + API. Modul pendukung: site.config.js, auth.js, r2.js
// Berjalan di Vercel (zero-config Express) maupun lokal: `node server.js`
const express = require("express");
const fs = require("fs");
const path = require("path");
const { PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const SITE = require("./site.config");
const { ADMIN_USER, checkLogin, makeToken, needAdmin } = require("./auth");
const { missingEnv, client: r2, bucket, publicBase, VIDEO, AUDIO } = require("./r2");

// Nama album jadi nama folder: hanya huruf, angka, spasi, - dan _
const cleanAlbum = (v) => String(v || "").replace(/[^\p{L}\p{N} _-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const needR2 = (req, res, next) => {
  const miss = missingEnv();
  return miss.length ? res.status(500).json({ error: "Environment variable belum lengkap: " + miss.join(", ") }) : next();
};

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
app.get("/", (req, res) => res.type("html").send(page));
app.get("/style.css", (req, res) => res.type("css").send(css));
app.get("/app.js", (req, res) => res.type("js").send(js));

app.get("/api/config", (req, res) => res.json({ ...SITE, adminUser: ADMIN_USER }));

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
    const lists = await Promise.all(["free/", "premium/", "uploads/"].map(listPrefix));
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
          url: `${publicBase()}/${parts.map(encodeURIComponent).join("/")}`,
        };
      })
      .filter(Boolean)
      .sort((x, y) => new Date(y.lastModified) - new Date(x.lastModified));
    res.setHeader("Cache-Control", "no-store");
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: "Gagal membaca isi bucket" });
  }
});

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
    const uploadUrl = await getSignedUrl(
      r2(),
      new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }),
      { expiresIn: 900 }
    );
    res.json({ uploadUrl, key, album: albumName });
  } catch (e) {
    res.status(500).json({ error: "Gagal membuat URL upload" });
  }
});

app.post("/api/login", async (req, res) => {
  if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ error: "Environment variable ADMIN_PASSWORD belum diisi" });
  const { username, password } = req.body || {};
  if (!checkLogin(username, password)) {
    await wait(1000); // memperlambat tebak-tebakan password
    return res.status(401).json({ error: "Username atau password salah" });
  }
  res.json({ token: makeToken() });
});

app.get("/api/me", needAdmin, (req, res) => res.json({ ok: true }));

app.post("/api/delete", needAdmin, needR2, async (req, res) => {
  const keys = (req.body && req.body.keys) || [];
  if (!Array.isArray(keys) || !keys.length || keys.length > 1000)
    return res.status(400).json({ error: "Daftar file tidak valid" });
  if (!keys.every((k) => typeof k === "string" && /^(free|premium|uploads)\//.test(k) && !k.includes("..")))
    return res.status(400).json({ error: "Hanya file di folder free/, premium/ atau uploads/ yang boleh dihapus" });
  try {
    await r2().send(new DeleteObjectsCommand({
      Bucket: bucket(),
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }));
    res.json({ deleted: keys.length });
  } catch (e) {
    res.status(500).json({ error: "Gagal menghapus file" });
  }
});

// Semua alamat lain → halaman tunggal (mis. /admin tetap membuka halaman yang sama)
app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Tidak ditemukan" });
  res.type("html").send(page);
});

module.exports = app;
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log("http://localhost:" + port));
}

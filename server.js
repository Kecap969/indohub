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

app.get("/api/list", needR2, async (req, res) => {
  try {
    const out = await r2().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: "uploads/", MaxKeys: 1000 }));
    const items = (out.Contents || [])
      .filter((o) => VIDEO.test(o.Key) || AUDIO.test(o.Key))
      .map((o) => {
        const parts = o.Key.split("/"); // uploads/<user>/<ts>-<nama>
        return {
          key: o.Key,
          title: parts[parts.length - 1].replace(/^\d+-/, ""),
          uploader: parts[1] || "",
          size: o.Size,
          lastModified: o.LastModified,
          type: AUDIO.test(o.Key) ? "audio" : "video",
          url: `${publicBase()}/${o.Key}`,
        };
      })
      .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    res.setHeader("Cache-Control", "no-store");
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: "Gagal membaca isi bucket" });
  }
});

app.post("/api/presign", needR2, async (req, res) => {
  const { username, filename, contentType, size } = req.body || {};
  if (!/^[a-zA-Z0-9_-]{2,30}$/.test(username || ""))
    return res.status(400).json({ error: "Username harus 2-30 karakter: huruf, angka, _ atau -" });
  if (username.toLowerCase() === ADMIN_USER)
    return res.status(403).json({ error: "Username ini khusus admin. Gunakan username lain." });
  if (!/^(video|audio)\//.test(contentType || ""))
    return res.status(400).json({ error: "Hanya file video atau audio yang boleh diupload" });
  if (!filename || typeof filename !== "string") return res.status(400).json({ error: "Nama file kosong" });
  if (!size || size > SITE.maxUploadMB * 1024 * 1024)
    return res.status(400).json({ error: `Ukuran file maksimal ${SITE.maxUploadMB} MB` });

  const safeName = filename.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-80) || "file";
  const key = `uploads/${username.toLowerCase()}/${Date.now()}-${safeName}`;
  try {
    const uploadUrl = await getSignedUrl(
      r2(),
      new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }),
      { expiresIn: 900 }
    );
    res.json({ uploadUrl, key, publicUrl: `${publicBase()}/${key}` });
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
  if (!keys.every((k) => typeof k === "string" && k.startsWith("uploads/") && !k.includes("..")))
    return res.status(400).json({ error: "Hanya file di folder uploads/ yang boleh dihapus" });
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

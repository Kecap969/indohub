// Pengaturan situs, sesi/login, password, database, dan penyimpanan media
const crypto = require("crypto");
const { promisify } = require("util");
const { S3Client } = require("@aws-sdk/client-s3");

/* ---------- pengaturan situs ---------- */
const SITE = {
  title: "Indohub",
  subtitle: "Streaming video dan audio",
  maxUploadMB: 2048,
  plans: { 1: 50000, 12: 100000 }, // paket: durasi (bulan) -> harga Rp
  pricePerMonth: 50000, // harga 1 bulan
};

/* ---------- sesi (token HMAC) ---------- */
const ADMIN_USER = (process.env.ADMIN_USERNAME || "kecap").toLowerCase();
const ADMIN_TTL = 12 * 60 * 60 * 1000;
const USER_TTL = 30 * 24 * 60 * 60 * 1000;

const secret = () => process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "";
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
const sign = (d) => crypto.createHmac("sha256", secret()).update(d).digest("base64url");

function makeToken(kind, user, ttl) {
  const payload = Buffer.from(JSON.stringify({ k: kind, u: user, exp: Date.now() + ttl })).toString("base64url");
  return payload + "." + sign(payload);
}
const makeAdminToken = () => makeToken("admin", ADMIN_USER, ADMIN_TTL);
const makeUserToken = (u) => makeToken("user", u, USER_TTL);

// Mengembalikan { k, u } kalau token valid, selain itu null
function readToken(req) {
  if (!secret()) return null;
  const h = req.headers["authorization"] || "";
  const [payload, sig] = (h.startsWith("Bearer ") ? h.slice(7) : "").split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, "base64url").toString());
    return d.exp > Date.now() ? d : null;
  } catch (e) {
    return null;
  }
}
const isAdminToken = (t) => !!t && t.k === "admin" && t.u === ADMIN_USER;

const needAdmin = (req, res, next) =>
  isAdminToken(readToken(req)) ? next() : res.status(401).json({ error: "Sesi admin habis, silakan masuk lagi" });
const needUser = (req, res, next) => {
  const t = readToken(req);
  if (!t || t.k !== "user") return res.status(401).json({ error: "Sesi habis, silakan masuk lagi" });
  req.user = t.u; // username huruf kecil
  next();
};

/* ---------- login admin & password user ---------- */
function checkLogin(username, password) {
  const userOk = String(username || "").toLowerCase() === ADMIN_USER;
  const passOk = crypto.timingSafeEqual(sha(password || ""), sha(process.env.ADMIN_PASSWORD));
  return userOk && passOk;
}
const scrypt = promisify(crypto.scrypt);
async function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(String(pw), salt, 32);
  return salt.toString("hex") + ":" + h.toString("hex");
}
async function checkPw(pw, stored) {
  const [s, h] = String(stored || "").split(":");
  if (!s || !h) return false;
  const x = await scrypt(String(pw), Buffer.from(s, "hex"), 32);
  const hb = Buffer.from(h, "hex");
  return x.length === hb.length && crypto.timingSafeEqual(x, hb);
}

/* ---------- Supabase (REST, hanya dipanggil dari server) ---------- */
const dbMissing = () => {
  const m = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY"].filter((k) => !process.env[k]);
  if (!secret()) m.push("SESSION_SECRET");
  return m;
};
async function db(method, path, body, prefer) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  const r = await fetch(process.env.SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/" + path, {
    method,
    headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", Prefer: prefer || "return=representation" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch (e) {}
  if (!r.ok) throw new Error((data && data.message) || "Kesalahan data " + r.status);
  return data;
}

/* ---------- Cloudflare R2 (bucket privat, link sementara) ---------- */
const NEED = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"];
const missingEnv = () => NEED.filter((k) => !process.env[k]);

const client = () =>
  new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  });

const bucket = () => process.env.R2_BUCKET;
const VIDEO = /\.(mp4|m4v|webm|mov)$/i; // m3u8 (HLS) tidak didukung pada bucket privat
const AUDIO = /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i;

module.exports = {
  SITE, ADMIN_USER,
  makeAdminToken, makeUserToken, readToken, isAdminToken, needAdmin, needUser,
  checkLogin, hashPw, checkPw,
  dbMissing, db,
  missingEnv, client, bucket, VIDEO, AUDIO,
};

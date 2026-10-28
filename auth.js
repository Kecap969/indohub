// Autentikasi admin (token HMAC bertanda tangan, berlaku 12 jam)
const crypto = require("crypto");

const ADMIN_USER = (process.env.ADMIN_USERNAME || "kecap").toLowerCase();
const TOKEN_TTL = 12 * 60 * 60 * 1000;

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
const sign = (d) => crypto.createHmac("sha256", process.env.ADMIN_PASSWORD).update(d).digest("base64url");

function checkLogin(username, password) {
  const userOk = String(username || "").toLowerCase() === ADMIN_USER;
  const passOk = crypto.timingSafeEqual(sha(password || ""), sha(process.env.ADMIN_PASSWORD));
  return userOk && passOk;
}
function makeToken() {
  const payload = Buffer.from(JSON.stringify({ u: ADMIN_USER, exp: Date.now() + TOKEN_TTL })).toString("base64url");
  return payload + "." + sign(payload);
}
function verifyToken(req) {
  if (!process.env.ADMIN_PASSWORD) return false;
  const h = req.headers["authorization"] || "";
  const [payload, sig] = (h.startsWith("Bearer ") ? h.slice(7) : "").split(".");
  if (!payload || !sig) return false;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try {
    const d = JSON.parse(Buffer.from(payload, "base64url").toString());
    return d.u === ADMIN_USER && d.exp > Date.now();
  } catch (e) {
    return false;
  }
}
const needAdmin = (req, res, next) =>
  verifyToken(req) ? next() : res.status(401).json({ error: "Sesi admin habis, silakan masuk lagi" });

module.exports = { ADMIN_USER, checkLogin, makeToken, verifyToken, needAdmin };

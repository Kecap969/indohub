const crypto = require("crypto");

const ADMIN_USER = () => (process.env.ADMIN_USERNAME || "kecap").toLowerCase();
const TTL_MS = 12 * 60 * 60 * 1000; // sesi admin 12 jam

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
const sign = (data) => crypto.createHmac("sha256", process.env.ADMIN_PASSWORD).update(data).digest("base64url");

function checkLogin(username, password) {
  if (!process.env.ADMIN_PASSWORD) return false;
  const userOk = String(username || "").toLowerCase() === ADMIN_USER();
  const passOk = crypto.timingSafeEqual(sha(password || ""), sha(process.env.ADMIN_PASSWORD));
  return userOk && passOk;
}

function makeToken() {
  const payload = Buffer.from(JSON.stringify({ u: ADMIN_USER(), exp: Date.now() + TTL_MS })).toString("base64url");
  return payload + "." + sign(payload);
}

function verifyToken(req) {
  if (!process.env.ADMIN_PASSWORD) return false;
  const h = req.headers["authorization"] || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : "";
  const [payload, sig] = t.split(".");
  if (!payload || !sig) return false;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try {
    const d = JSON.parse(Buffer.from(payload, "base64url").toString());
    return d.u === ADMIN_USER() && d.exp > Date.now();
  } catch (e) {
    return false;
  }
}

module.exports = { checkLogin, makeToken, verifyToken, ADMIN_USER };

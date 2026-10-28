const { checkLogin, makeToken } = require("./_auth");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak diizinkan" });
  if (!process.env.ADMIN_PASSWORD)
    return res.status(500).json({ error: "Environment variable ADMIN_PASSWORD belum diisi" });

  const { username, password } = req.body || {};
  if (!checkLogin(username, password)) {
    await wait(1000); // memperlambat tebak-tebakan password
    return res.status(401).json({ error: "Username atau password salah" });
  }
  res.status(200).json({ token: makeToken() });
};

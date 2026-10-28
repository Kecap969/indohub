const { DeleteObjectsCommand } = require("@aws-sdk/client-s3");
const { client, missingEnv, bucket } = require("./_r2");
const { verifyToken } = require("./_auth");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak diizinkan" });
  if (!verifyToken(req)) return res.status(401).json({ error: "Sesi admin habis, silakan masuk lagi" });

  const miss = missingEnv();
  if (miss.length) return res.status(500).json({ error: "Environment variable belum lengkap: " + miss.join(", ") });

  const keys = (req.body && req.body.keys) || [];
  if (!Array.isArray(keys) || !keys.length || keys.length > 1000)
    return res.status(400).json({ error: "Daftar file tidak valid" });
  if (!keys.every((k) => typeof k === "string" && k.startsWith("uploads/") && !k.includes("..")))
    return res.status(400).json({ error: "Hanya file di folder uploads/ yang boleh dihapus" });

  try {
    await client().send(new DeleteObjectsCommand({
      Bucket: bucket(),
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }));
    res.status(200).json({ deleted: keys.length });
  } catch (e) {
    res.status(500).json({ error: "Gagal menghapus file" });
  }
};

const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { client, missingEnv, publicBase, bucket } = require("./_r2");

const MAX_MB = 2048; // batas ukuran per file (dicek juga di sisi klien)

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak diizinkan" });

  const miss = missingEnv();
  if (miss.length) return res.status(500).json({ error: "Environment variable belum lengkap: " + miss.join(", ") });

  const { username, filename, contentType, size } = req.body || {};

  if (!/^[a-zA-Z0-9_-]{2,30}$/.test(username || ""))
    return res.status(400).json({ error: "Username harus 2-30 karakter: huruf, angka, _ atau -" });
  if (!/^(video|audio)\//.test(contentType || ""))
    return res.status(400).json({ error: "Hanya file video atau audio yang boleh diupload" });
  if (!filename || typeof filename !== "string")
    return res.status(400).json({ error: "Nama file kosong" });
  if (!size || size > MAX_MB * 1024 * 1024)
    return res.status(400).json({ error: `Ukuran file maksimal ${MAX_MB} MB` });

  const safeName = filename.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-80) || "file";
  const key = `uploads/${username.toLowerCase()}/${Date.now()}-${safeName}`;

  try {
    const uploadUrl = await getSignedUrl(
      client(),
      new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }),
      { expiresIn: 900 }
    );
    res.status(200).json({ uploadUrl, key, publicUrl: `${publicBase()}/${key}` });
  } catch (e) {
    res.status(500).json({ error: "Gagal membuat URL upload" });
  }
};

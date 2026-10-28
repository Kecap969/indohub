const { ListObjectsV2Command } = require("@aws-sdk/client-s3");
const { client, missingEnv, publicBase, bucket } = require("./_r2");

const VIDEO = /\.(mp4|m4v|webm|mov|m3u8)$/i;
const AUDIO = /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i;

module.exports = async (req, res) => {
  const miss = missingEnv();
  if (miss.length) return res.status(500).json({ error: "Environment variable belum lengkap: " + miss.join(", ") });

  try {
    const out = await client().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: "uploads/", MaxKeys: 1000 }));
    const items = (out.Contents || [])
      .filter((o) => VIDEO.test(o.Key) || AUDIO.test(o.Key))
      .map((o) => {
        const parts = o.Key.split("/"); // uploads/<user>/<ts>-<name>
        const file = parts[parts.length - 1].replace(/^\d+-/, "");
        return {
          key: o.Key,
          title: file,
          uploader: parts[1] || "",
          size: o.Size,
          lastModified: o.LastModified,
          type: AUDIO.test(o.Key) ? "audio" : "video",
          url: `${publicBase()}/${o.Key}`,
        };
      })
      .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ items });
  } catch (e) {
    res.status(500).json({ error: "Gagal membaca isi bucket" });
  }
};

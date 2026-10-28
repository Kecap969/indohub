// Koneksi & helper Cloudflare R2
const { S3Client } = require("@aws-sdk/client-s3");

const NEED = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_URL"];
const missingEnv = () => NEED.filter((k) => !process.env[k]);

const client = () =>
  new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  });

const bucket = () => process.env.R2_BUCKET;
const publicBase = () => process.env.R2_PUBLIC_URL.replace(/\/+$/, "");
const VIDEO = /\.(mp4|m4v|webm|mov|m3u8)$/i;
const AUDIO = /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i;

module.exports = { missingEnv, client, bucket, publicBase, VIDEO, AUDIO };

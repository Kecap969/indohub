const { S3Client } = require("@aws-sdk/client-s3");

const need = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_URL"];

function missingEnv() {
  return need.filter((k) => !process.env[k]);
}

function client() {
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

const publicBase = () => process.env.R2_PUBLIC_URL.replace(/\/+$/, "");

module.exports = { client, missingEnv, publicBase, bucket: () => process.env.R2_BUCKET };

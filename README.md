# Perpustakaan Media (R2 + Vercel)

Halaman pertama meminta username, lalu user bisa upload dan streaming video/audio dari Cloudflare R2.
Kunci R2 hanya dipakai di server (folder `api/`), tidak pernah dikirim ke browser.

## 1. Environment Variables (Vercel → Project → Settings → Environment Variables)
| Nama | Isi |
|---|---|
| R2_ACCOUNT_ID | Account ID Cloudflare |
| R2_ACCESS_KEY_ID | Access Key ID token R2 |
| R2_SECRET_ACCESS_KEY | Secret Access Key token R2 |
| R2_BUCKET | Nama bucket |
| R2_PUBLIC_URL | Domain publik bucket, mis. https://media.domainmu.com |
| ADMIN_PASSWORD | Password untuk halaman /admin (username: kecap) |
| ADMIN_USERNAME | (opsional) ganti username admin, default `kecap` |

Setelah mengisi/ubah variable, lakukan **Redeploy**.

## 2. CORS bucket R2
```json
[{
  "AllowedOrigins": ["https://domainmu.com", "https://namaproject.vercel.app"],
  "AllowedMethods": ["GET", "HEAD", "PUT"],
  "AllowedHeaders": ["Content-Type", "Range"],
  "ExposeHeaders": ["Content-Length", "Content-Range", "Accept-Ranges", "ETag"],
  "MaxAgeSeconds": 3600
}]
```

## 3. Deploy
Push ke GitHub → Vercel Import Project → Framework Preset **Other** → Deploy.

## Tes lokal
`npm i -g vercel`, buat file `.env.local` berisi 5 variable di atas, lalu `vercel dev`.

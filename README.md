# Perpustakaan Media (R2 + Vercel)

Semua file di root, tanpa folder `api/`.

| File | Fungsi |
|---|---|
| `index.html` | Kerangka satu halaman (masuk, media, dashboard admin) |
| `style.css` | Seluruh tampilan |
| `app.js` | Logika sisi browser (gate, pemutar, upload, dashboard admin) |
| `server.js` | Server Express: halaman + rute `/api/config`, `/api/list`, `/api/presign`, `/api/login`, `/api/me`, `/api/delete` |
| `auth.js` | Login & token admin |
| `r2.js` | Koneksi Cloudflare R2 |
| `site.config.js` | Judul, subjudul, batas upload (MB) |
| `package.json` | Dependensi |

## Alur
- Username biasa → halaman media (upload + streaming).
- Ketik `kecap` (atau `ADMIN_USERNAME`) → kolom password muncul → jika benar, dashboard admin tampil di halaman yang sama.

## Environment Variables (Vercel)
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`, `ADMIN_PASSWORD` (wajib), `ADMIN_USERNAME` (opsional, default `kecap`). Redeploy setelah mengubah.

## CORS bucket R2
```json
[{
  "AllowedOrigins": ["https://domainmu.com", "https://namaproject.vercel.app"],
  "AllowedMethods": ["GET", "HEAD", "PUT"],
  "AllowedHeaders": ["Content-Type", "Range"],
  "ExposeHeaders": ["Content-Length", "Content-Range", "Accept-Ranges", "ETag"],
  "MaxAgeSeconds": 3600
}]
```

## Deploy
Hapus `api/`, `admin.html`, `config.js`, `vercel.json` lama; push file baru; Redeploy.
Tes lokal: `npm install`, set variable, `node server.js`.

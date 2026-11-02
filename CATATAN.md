# Update: Download aplikasi di Profil + upload APK oleh admin

Timpa 6 file ini di root repo (server.js dan 2 file HTML sudah termasuk perubahan PWA sebelumnya), lalu push.

Alur:
1. Admin -> tab Pembayaran -> "Aplikasi Android (APK)" -> pilih file .apk (+ versi opsional) -> Upload APK.
   File disimpan di bucket: apk/indohub.apk (menimpa yang lama) + apk/info.json (label versi).
2. Pengguna -> Profil -> kartu "Aplikasi Android" -> Download aplikasi.

Catatan:
- Kartu tidak tampil di dalam aplikasi yang sudah terpasang, di iPhone/iPad, atau jika belum ada APK.
- Folder apk/ tidak ikut daftar media (daftar hanya membaca free/, premium/, uploads/).
- Upload APK memakai CORS R2 yang sama dengan upload video (method PUT + header Content-Type).

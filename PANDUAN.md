# Indohub jadi aplikasi (PWA + Android)

## 1. Taruh di repo (timpa file lama)
Salin semua isi folder ini ke root repo, sejajar dengan `app.js`:
- File baru: `manifest.json`, `sw.js`, `offline.html`, folder `icons/`
- File diperbarui: `server.js`, `vercel.json`, `index.html`, `admin.html`

Lalu commit dan push. Vercel akan deploy otomatis.

## 2. Cek di browser (Chrome HP atau desktop)
- Buka `https://DOMAIN-ANDA/manifest.json` -> harus tampil JSON.
- Buka `https://DOMAIN-ANDA/sw.js` -> harus tampil kode JavaScript.
- Chrome menu -> "Instal aplikasi" / "Tambahkan ke layar utama" harus muncul.

## 3. Buat APK/AAB di PWABuilder
1. pwabuilder.com -> tempel URL situs -> Start.
2. Package for stores -> Android -> isi Package ID (catat!) -> Download.
3. Dari zip yang diunduh: `.apk` untuk dibagikan langsung, `.aab` untuk Play Store.
4. Buka file `signing-key-info.txt` di zip itu dan ambil nilai SHA-256 fingerprint.
5. SIMPAN file keystore + passwordnya. Kalau hilang, update tidak bisa dirilis.

## 4. Hubungkan aplikasi dengan situs (supaya tanpa bilah browser)
Di Vercel -> Project -> Settings -> Environment Variables, tambahkan:
- `ANDROID_PACKAGE_NAME` = Package ID dari langkah 3 (contoh: `com.indohub.app`)
- `ANDROID_SHA256` = fingerprint SHA-256 (beberapa nilai pisahkan koma)

Redeploy, lalu cek `https://DOMAIN-ANDA/.well-known/assetlinks.json` harus berisi data (bukan `[]`).
Jika dipublikasikan lewat Play Store, tambahkan juga fingerprint dari
Play Console -> Setup -> App signing, ke `ANDROID_SHA256` (pisahkan koma).

## Catatan
- Setelah mengubah file css/js, naikkan `?v=10` di index.html/admin.html agar semua pengguna mendapat versi baru.
- Untuk memaksa cache lama dibuang, ubah `VERSION` di `sw.js`.
- `viewport-fit=cover` ditambahkan karena CSS Anda sudah memakai safe-area (area notch).

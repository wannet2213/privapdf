# PrivaPDF

Tools PDF yang **100% diproses lokal di browser** (React + Vite + WASM) — tanpa akun, tanpa upload, tanpa telemetry. File tidak pernah meninggalkan perangkatmu. Kini 20 tool: PDF (merge/split/rotate/…), formulir, tanda tangan, dan toolkit gambar.

## Daftar Tool (20)

| Tool | Fungsi |
| --- | --- |
| Gabungkan PDF | Merge beberapa PDF, atur urutan visual per halaman/per file |
| Pisahkan PDF | Ekstrak halaman terpilih, per rentang, atau per kelompok |
| Hapus halaman | Buang halaman yang tidak diinginkan |
| Urutkan ulang | Susun ulang halaman via drag & drop |
| Putar halaman | Rotasi semua atau halaman terpilih |
| Nomor halaman | Posisi, format (angka/romawi), font, offset |
| Tanda air | Teks atau gambar; center, tile, posisi, custom font TTF/OTF |
| Potong halaman | Margin custom, global atau per halaman |
| Kompres PDF | Object streams + bersih-bersih metadata |
| Hapus proteksi | Buka PDF terenkripsi (user/owner password) via qpdf |
| Beri password | Enkripsi AES-256, dengan password pemilik opsional |
| Edit metadata | Judul, penulis, subjek, kata kunci, pembuat |
| Isi formulir | Isi field AcroForm (teks, checkbox, dropdown) + pratinjau |
| Ratakan (flatten) | Kunci formulir/anotasi jadi konten statis |
| PDF ke gambar | PNG/JPEG per halaman — terpisah atau satu ZIP |
| Ekstrak teks | Semua teks ke file .txt |
| Tanda tangan / stempel | Gambar tangan di canvas atau unggah PNG/JPG, tempel per halaman |
| Gambar ke PDF | PNG/JPEG → PDF |
| Toolkit gambar | Kompres, resize massal, konversi PNG/JPEG/WebP; re-encode menghapus EXIF |
| Office ke PDF | DOCX/DOC, XLSX/XLS, PPTX/PPT, ODT/ODS/ODP, RTF, CSV, HTML (opsional — lihat bawah) |

Catatan UX sentuh: **menyeret kartu/baris di layar sentuh = tahan dulu (±0,25 detik) baru seret**; geser sebelum itu tetap berfungsi sebagai scroll. Di mouse, drag langsung.

## Prasyarat

- Node.js `^20.19.0` atau `>=22.12.0` (syarat Vite 8; dikembangkan dengan Node 24)
- npm

## Menjalankan dari clone baru

```bash
git clone <url-repo> privapdf
cd privapdf
npm ci
npm run dev
```

Semua tool langsung jalan — **kecuali "Office ke PDF"**, karena aset LibreOffice WASM sengaja tidak ikut repo (lihat [File yang tidak ikut repo](#file-yang-tidak-ikut-repo-by-design)).

### Opsional: aktifkan Office ke PDF (~250 MB)

```bash
npm run setup:office
```

- Menyalin 5 aset dari `node_modules` ke `public/wasm/office/` (folder gitignored, idempoten).
- Sekalian menaikkan batas waktu inisialisasi WASM di worker dari 2 menit → 10 menit — penting saat aset diambil lewat tunnel/upload lambat (batas bawaan vendor 2 menit tidak cukup).
- **Restart dev server** setelahnya.
- Pemakaian pertama: browser memuat ±250 MB dan mengompilasi WASM — butuh waktu puluhan detik dan RAM besar. Konversi berikutnya jauh lebih cepat (HTTP cache + engine hangat selama sesi).
- Tanpa langkah ini HANYA tool "Office ke PDF" yang gagal saat dipakai; tool lain normal.

## Development lewat tunnel / domain sendiri

Vite menolak request dengan `Host` tak dikenal (proteksi DNS rebinding). Tambahkan domainmu ke `server.allowedHosts` di `vite.config.ts` — `test.irwannet.my.id` sudah terdaftar sebagai contoh. Jangan gunakan `allowedHosts: true`.

## Perintah

| Perintah | Fungsi |
| --- | --- |
| `npm run dev` | Dev server (sudah dengan header COOP/COEP untuk WASM) |
| `npm run setup:office` | Salin aset Office WASM + patch timeout (opsional) |
| `npm run check` | Type-check TypeScript |
| `npm test` | Seluruh test (vitest) |
| `npm run build` | Build produksi ke `dist/` |
| `npm audit` | Cek kerentanan dependensi |

## Deploy production

```bash
npm run build   # output: dist/
```

**Penting sebelum build untuk hosting statis:** jika `public/wasm/office/` ada (karena `setup:office`), Vite menyalinnya ke `dist/` dan **Cloudflare Pages menolak file statis > 25 MB**. Untuk deploy ke hosting statis, hapus dulu folder tersebut:

```bash
rm -rf public/wasm/office && npm run build
```

(Folder bisa dibuat ulang kapan saja dengan `npm run setup:office`.)

### Cloudflare Pages (direkomendasikan)

- Deploy isi `dist/`. Konfigurasi sudah lengkap di repo: `public/_redirects` (SPA fallback) dan `public/_headers` (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`, `X-Frame-Options: DENY`, `nosniff`, Permissions-Policy). Header COOP/COEP wajib dipertahankan agar Office WASM dapat berjalan.
- Office ke PDF **tidak tersedia** di CF Pages (batas 25 MB/file). Untuk mengaktifkannya di production, host aset di tempat lain (Vercel/object storage/CDN) lalu arahkan path di `createWasmPaths()` pada `src/engines/office-native.ts` ke sana.

### Vercel (alternatif)

- `vercel.json` sudah berisi SPA rewrites **dan** headers keamanan/COOP/COEP yang sama dengan `_headers` — deploy langsung benar.
- Deploy via **integrasi Git**: aset office tidak ikut (gitignored) → semua tool jalan kecuali Office ke PDF.
- Deploy via **CLI dari mesin lokal** (`npx vercel`): `public/wasm/office/` ikut ter-upload (Vercel menerima file besar) → Office ke PDF aktif di production.

### Setelah deploy

- Jika halaman terasa usang, unregister service worker lalu reload (dev server: `Application → Service Workers → Unregister`).
- Deep link 404 berarti `_redirects`/rewrites tidak ikut ter-deploy.

## Validasi sebelum push

```bash
npm run check   # wajib lulus
npm test        # wajib lulus
npm audit       # 0 kerentanan
```

## File yang tidak ikut repo (by design)

| Path | Alasan | Cara mendapatkan |
| --- | --- | --- |
| `public/wasm/office/` | Aset LibreOffice WASM ±250 MB — GitHub menolak file > 100 MB, CF Pages > 25 MB | `npm run setup:office` |
| `dist/` | Hasil build | `npm run build` |

## Privasi dan keamanan

Input berada di RAM tab browser; tidak ada akun, telemetry, atau upload aplikasi. Password PDF hanya berada di memori dan dibersihkan saat sesi berakhir. Session dibersihkan saat workspace unmount, `pagehide`, dan `beforeunload`, tetapi browser/OS tidak menjamin penghapusan fisik dari semua salinan memori. Jangan memproses dokumen yang membutuhkan kontrol DLP/forensik khusus. Output dibuat sebagai download lokal.

Laporan audit keamanan: [SECURITY-AUDIT.md](./SECURITY-AUDIT.md) (snapshot pada tanggal audit; fitur yang ditambah setelahnya belum tercakup).

## Troubleshooting

- **Office gagal/timeout**: jalankan `npm run setup:office`, restart dev server, pastikan HTTPS + header COOP/COEP aktif dan browser mendukung WASM/Worker. Pemakaian pertama memang lambat (±250 MB).
- **"Blocked request. This host is not allowed"**: tambahkan domain ke `server.allowedHosts` di `vite.config.ts`, restart dev server.
- **Deep link 404**: deploy `dist/` lengkap dengan `_redirects` (CF Pages) atau pastikan `vercel.json` ikut.
- **File ditolak**: periksa ekstensi dan isi file; file rusak atau ekstensi tidak cocok sengaja ditolak (magic bytes diverifikasi).
- **Drag tidak jalan di HP**: tahan kartu ±0,25 detik sampai terlihat "terangkat", baru seret.
- **Isi formulir kosong**: PDF bukan AcroForm (tidak punya field). Gunakan tanda tangan untuk mengisi manual, atau flatten untuk mengunci anotasi.
- **Aset lama saat deploy**: unregister service worker lalu reload setelah deployment.

# PrivaPDF

Tools PDF yang **100% diproses lokal di browser** (React + Vite + WASM) — tanpa akun, tanpa upload, tanpa telemetry. File tidak pernah meninggalkan perangkatmu. Kini 21 tool: PDF (merge/split/rotate/…), formulir, tanda tangan, toolkit gambar, hapus latar.

Lisensi: **AGPL-3.0-or-later** (code) — dipakai karena tool "Hapus latar" memakai `@imgly/background-removal` yang berlisensi AGPL-3.0; model AI lain (U²-Net/ISNet via rembg) berlisensi Apache-2.0.

## Daftar Tool (21)

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
| Hapus latar | AI (U²-Net/ISNet, latar apa pun) atau mode warna solid → PNG transparan |
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
- Membuat berkas `.gz` untuk tiap aset (237 MB → ±75 MB) supaya nginx dapat menyajikannya lewat `gzip_static`; `soffice.wasm` turun dari 141 MB ke 47,5 MB sehingga bisa di-cache Cloudflare.
- Menaikkan batas waktu inisialisasi WASM di worker dari 2 menit → 10 menit — penting saat aset diambil lewat tunnel/upload lambat (batas bawaan vendor 2 menit tidak cukup).
- Urutannya penting: `.gz` dibuat **setelah** patch timeout, kalau tidak berkas terkompresi memuat versi yang belum ter-patch.
- **Restart dev server** setelahnya.
- Pemakaian pertama: browser memuat ±250 MB dan mengompilasi WASM — butuh waktu puluhan detik dan RAM besar. Konversi berikutnya jauh lebih cepat (HTTP cache + engine hangat selama sesi).
- Tanpa langkah ini HANYA tool "Office ke PDF" yang gagal saat dipakai; tool lain normal.

### Opsional: model AI hapus latar

```bash
npm run setup:models   # u2netp (Apache-2.0, ±4 MB) + runtime ONNX → public/models/bg/ (±30 MB)
npm run setup:imgly    # aset @imgly/background-removal (AGPL-3.0) → public/imgly/ (±160 MB)
```

- **Seimbang / Ringan (imgly)** — ISNet fp16 ±22 MB / quint8 ±11 MB, default tool. Aset di-self-host dari CDN resmi imgly; tidak ada request pihak ketiga saat runtime.
- **Cepat** — u2netp ±4 MB, model Apache-2.0 di worker ORT milik sendiri.
- Semua inferensi berjalan di worker, tanpa melonggarkan CSP.
- Tanpa langkah ini, tab "Warna solid" pada tool Hapus latar tetap berfungsi.
- Catatan lisensi: penggunaan `@imgly/background-removal` membuat seluruh aplikasi ini berlisensi AGPL-3.0-or-later.

## Development lewat tunnel / domain sendiri

Vite menolak request dengan `Host` tak dikenal (proteksi DNS rebinding). Tambahkan domainmu ke `server.allowedHosts` di `vite.config.ts` — `test.irwannet.my.id` sudah terdaftar sebagai contoh. Jangan gunakan `allowedHosts: true`.

## Perintah

| Perintah | Fungsi |
| --- | --- |
| `npm run dev` | Dev server (sudah dengan header COOP/COEP untuk WASM) |
| `npm run setup:office` | Salin aset Office WASM + patch timeout + siapkan berkas `.gz` (opsional) |
| `npm run setup:models` | Unduh model AI hapus latar + runtime ONNX (opsional) |
| `npm run setup:imgly` | Unduh aset imgly background-removal (opsional) |
| `npm run check` | Type-check TypeScript |
| `npm run check:dist` | Periksa `dist/` tanpa build penuh (aturan worker & `.ts` mentah) |
| `npm test` | Seluruh test (vitest) |
| `npm run build` | Build produksi ke `dist/` + periksa hasil build |
| `npm audit` | Cek kerentanan dependensi |

## Deploy production (VPS ini)

Situs ini **bukan** Cloudflare Pages dan bukan Vercel. Yang tayang: **nginx native** menyajikan hasil build statis dari `/var/www/privapdf`, diakses publik lewat **Cloudflare Tunnel** (remote-managed) → origin port 80.

Tidak ada proses aplikasi, tidak ada port khusus, dan tidak ada unit systemd untuk situs ini. Karena itu `npm run dev` **tidak pernah** dijalankan di server — dev server hanya untuk mengembangkan di mesin sendiri.

| | |
| --- | --- |
| Penyaji | nginx, `root /var/www/privapdf` (`/etc/nginx/conf.d/privapdf.conf`) |
| Dipilih lewat | `server_name`, **bukan port** — `privapdf.my.id` berbagi `listen 80` dengan vhost lain |
| Proses aplikasi | tidak ada (tanpa Node, tanpa systemd, tanpa Docker) |
| Header COOP/COEP | wajib, diatur di `privapdf.conf`; tanpanya Office WASM mati |
| Kompresi | `gzip_static on;` — berkas `.gz` disiapkan oleh `npm run setup:office` |
| Ingress tunnel | dikelola dari dashboard Cloudflare Zero Trust, jadi **tidak ada** berkas config tunnel di VPS |

Hanya `privapdf.my.id` yang punya DNS. `www.privapdf.my.id`, `privapdf.web.id`, dan `www.privapdf.web.id` masih terdaftar di `server_name` tetapi belum ada DNS/tunnel — memang belum bisa dibuka.

### Langkah deploy

```bash
cd /root/privapdf
git pull --ff-only origin main
npm ci
npm run setup:office          # aset WASM + berkas .gz (wajib tiap deploy: public/wasm gitignored)
npm run build                 # tsc + vite build + pemeriksaan dist
sudo rsync -a --delete dist/ /var/www/privapdf/
sudo chown -R www-data:www-data /var/www/privapdf
```

nginx tidak perlu di-reload — berkas disajikan langsung dari disk. `rsync -a --delete` dipakai (bukan `rm -rf` lalu `cp`) supaya tidak ada jendela situs mengembalikan 404 saat deploy.

### Pemeriksaan hasil build (`scripts/check-dist.mjs`)

`npm run build` **menolak** hasil yang akan rusak di produksi. Ini bukan hiasan: bug worker pernah lolos `tsc`, lolos 160 test vitest, dan lolos uji manual di `npm run dev` — lalu mati begitu di-deploy, karena yang rusak bukan logika melainkan perilaku bundling.

| Pemeriksaan (semua fatal) | Kenapa |
| --- | --- |
| Tidak ada berkas `.ts`/`.tsx` mentah di `dist/` | nginx memetakan `.ts` → `video/mp2t` (lihat `mime.types`), jadi worker mati di produksi |
| Tidak ada aset yang merujuk `assets/*.ts` | rujukan itu berakhir `video/mp2t`/404 di produksi |
| Tidak ada `new Worker(<var>)` yang isinya `data:` URL | CSP `worker-src 'self' blob:` menolak `data:` |
| Chunk worker wajib ada (Hapus Latar ×2, worker PDF, worker pdf.js) | menangkap varian `data:` yang di-inline Vite (worker < 4 kB) |

`npm run check:dist` menjalankan pemeriksaan yang sama tanpa build penuh.

Aturan yang dijaga: `new URL(...)` **wajib inline** di dalam `new Worker(...)`. Kalau disimpan ke variabel lebih dulu, Vite tidak mengenalinya sebagai worker.

```ts
// benar — Vite membundelnya jadi chunk worker ter-hash
new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

// salah — Vite memperlakukannya sebagai aset biasa; .ts mentah ikut ke dist
const url = new URL('./worker.ts', import.meta.url);
new Worker(url, { type: 'module' });
```

### Verifikasi setelah deploy

```bash
curl -s https://privapdf.my.id/ | grep -o 'index-[A-Za-z0-9_-]*\.js'   # hash bundle baru
curl -s https://privapdf.my.id/ | grep -c googleapis                    # harus 0
curl -sI https://privapdf.my.id/ | grep -i cross-origin                 # COOP/COEP
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' \
  https://privapdf.my.id/wasm/office/soffice.wasm                        # 200 application/wasm
```

### Berkas platform lain

`vercel.json`, `public/_headers`, dan `public/_redirects` berformat Vercel/Cloudflare Pages. Di nginx ketiganya **inert** — header keamanan dan SPA fallback ditangani `privapdf.conf`. Dipertahankan hanya agar `dist/` masih bisa di-host di platform bergaya Pages.

## Validasi sebelum push

```bash
npm run check   # wajib lulus
npm test        # wajib lulus
npm audit       # 0 kerentanan
```

## File yang tidak ikut repo (by design)

| Path | Alasan | Cara mendapatkan |
| --- | --- | --- |
| `public/wasm/office/` | Aset LibreOffice WASM 237 MB + berkas `.gz` ±75 MB — GitHub menolak file > 100 MB | `npm run setup:office` |
| `public/models/bg/` | Model u2netp + runtime ONNX ±30 MB | `npm run setup:models` |
| `public/imgly/` | Aset @imgly/background-removal ±160 MB | `npm run setup:imgly` |
| `dist/` | Hasil build | `npm run build` |

## Privasi dan keamanan

Input berada di RAM tab browser; tidak ada akun, telemetry, atau upload aplikasi. Password PDF hanya berada di memori dan dibersihkan saat sesi berakhir. Session dibersihkan saat workspace unmount, `pagehide`, dan `beforeunload`, tetapi browser/OS tidak menjamin penghapusan fisik dari semua salinan memori. Jangan memproses dokumen yang membutuhkan kontrol DLP/forensik khusus. Output dibuat sebagai download lokal.

Laporan audit keamanan: [SECURITY-AUDIT.md](./SECURITY-AUDIT.md) (snapshot pada tanggal audit; fitur yang ditambah setelahnya belum tercakup).

## Troubleshooting

- **Office gagal/timeout**: jalankan `npm run setup:office`, restart dev server, pastikan HTTPS + header COOP/COEP aktif dan browser mendukung WASM/Worker. Pemakaian pertama memang lambat (237 MB, ±75 MB setelah gzip). Batas konversi 10 menit, dan aset mulai diunduh begitu file dipilih — jadi menunggu sebentar sebelum menekan tombol konversi membuatnya jauh lebih cepat.
- **Build ditolak `scripts/check-dist.mjs`**: ada worker yang tidak dikenali Vite. Perbaiki dengan pola `new Worker(new URL(...))` **inline**, bukan URL yang disimpan ke variabel dulu. Jangan lewati pemeriksaan ini: kalau dipaksa deploy, fiturnya mati hanya di produksi.
- **"Blocked request. This host is not allowed"**: tambahkan domain ke `server.allowedHosts` di `vite.config.ts`, restart dev server.
- **Deep link 404**: pastikan `try_files $uri $uri/ /index.html` masih ada di `/etc/nginx/conf.d/privapdf.conf`.
- **Aset `.ts` disajikan sebagai `video/mp2t`**: itu pemetaan bawaan nginx, bukan kerusakan konfigurasi. Yang salah adalah `.ts` mentah ikut ke `dist/` — `scripts/check-dist.mjs` yang mencegahnya.
- **File ditolak**: periksa ekstensi dan isi file; file rusak atau ekstensi tidak cocok sengaja ditolak (magic bytes diverifikasi).
- **Drag tidak jalan di HP**: tahan kartu ±0,25 detik sampai terlihat "terangkat", baru seret.
- **Isi formulir kosong**: PDF bukan AcroForm (tidak punya field). Gunakan tanda tangan untuk mengisi manual, atau flatten untuk mengunci anotasi.
- **Aset lama saat deploy**: unregister service worker lalu reload setelah deployment.

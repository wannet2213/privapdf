# PrivaPDF

Tools PDF yang **100% diproses lokal di browser** (React + Vite + WASM) — tanpa akun, tanpa upload, tanpa telemetry. File tidak pernah meninggalkan perangkat pengguna. Tersedia 21 tool: PDF (gabung/split/rotate/…), formulir, tanda tangan, toolkit gambar, hapus latar, Office ke PDF.

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
| Tanda air gambar | Teks atau logo di foto PNG/JPEG/WebP, banyak sekaligus (ZIP); opsi sama dengan tanda air PDF |
| Hapus latar | AI (U²-Net/ISNet, latar apa pun) atau mode warna solid → PNG transparan |
| Office ke PDF | DOCX/DOC, XLSX/XLS, PPTX/PPT, ODT/ODS/ODP, RTF, CSV, HTML (opsional — lihat bawah) |

Batas per sesi: **50 MB per file, maksimal 10 file, total 120 MB** (termasuk file yang ditambahkan belakangan di Gabungkan PDF). Alat satu-file hanya memakai file pertama bila beberapa file dijatuhkan sekaligus; file berformat lain diabaikan.

Catatan UX sentuh: **menyeret kartu/baris di layar sentuh = tahan dulu (±0,25 detik) baru seret**; geser sebelum itu tetap berfungsi sebagai scroll. Di mouse, drag langsung.

## Mulai cepat

Prasyarat: **Node.js `^20.19.0` atau `>=22.12.0`** (syarat Vite 8) dan npm.

```bash
git clone <url-repo ini> privapdf
cd privapdf
npm ci
npm run dev
```

Buka `http://localhost:5173` — hampir semua tool langsung jalan. **Kecuali "Office ke PDF"** (dan sebagian mode AI "Hapus latar"), karena asetnya sengaja tidak ikut repo — aktifkan dengan langkah opsional di bawah.

### Opsional 1: Office ke PDF (aset ±237 MB)

```bash
npm run setup:office
```

Yang dilakukan script (idempoten — aman dijalankan berulang):

- Menyalin 5 aset LibreOffice WASM dari `node_modules` ke `public/wasm/office/` (folder gitignored).
- Menaikkan batas waktu inisialisasi WASM di worker dari 2 menit → 10 menit (penting saat koneksi lambat).
- Membuat salinan terkompresi **untuk tiap aset**: `.gz` (237 MB → ±75 MB) dan `.br` brotli (→ **±50 MB**) — server yang mendukung prakompresi akan mengunduh versi terkecil yang didukung browser pengunjung. Urutannya penting: kompresi dibuat **setelah** patch timeout.
- **Restart dev server** setelahnya.

Pemakaian pertama di browser: mengunduh ±50 MB (brotli) lalu mengompilasi WASM — progress-nya tampil di layar. Pemakaian berikutnya jauh lebih cepat (HTTP cache + engine tetap hangat selama sesi). Tanpa langkah ini HANYA tool "Office ke PDF" yang tidak jalan; tool lain normal.

### Opsional 2: model AI hapus latar

```bash
npm run setup:models   # u2netp (Apache-2.0, ±4 MB) + runtime ONNX → public/models/bg/ (±30 MB)
npm run setup:imgly    # aset @imgly/background-removal (AGPL-3.0) → public/imgly/ (±160 MB)
```

- **Seimbang / Ringan (imgly)** — ISNet fp16 ±22 MB / quint8 ±11 MB, default tool.
- **Cepat** — u2netp ±4 MB.
- Tanpa langkah ini, tab "Warna solid" pada tool Hapus latar tetap berfungsi.

## Deploy — pilih salah satu cara

Hasil build adalah **situs statis murni** (`dist/`) — tidak ada backend, tidak ada database. Yang dibutuhkan penyaji:

1. **Header COOP/COEP** (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`) — **wajib** untuk Office ke PDF; tanpanya browser tidak memberi SharedArrayBuffer dan fitur itu mati.
2. **SPA fallback** — rute halaman tak dikenal (mis. `/tools/merge`) menjawab `index.html` (status 200, `Cache-Control: no-cache`). **Aset yang hilang** (`/assets/`, `/wasm/`, `/models/`, `/imgly/`, atau path berekstensi) sebaiknya **404**, bukan `index.html` — kalau tidak, tab lama yang meminta chunk versi sebelumnya menerima HTML yang tersimpan di cache sebagai aset.
3. **MIME benar** — `.wasm` sebagai `application/wasm`; jangan menyajikan berkas `.ts` mentah.

### Cara 1 — server bawaan `npm run serve` (paling simpel, tanpa nginx/Caddy)

```bash
npm run build
npm run serve                  # mendengarkan di http://0.0.0.0:8080
PORT=9000 npm run serve        # port lain
HOST=127.0.0.1 npm run serve   # hanya lokal
```

Server kecil tanpa dependensi (`scripts/serve-dist.mjs`) sudah mengurus semuanya: header keamanan + COOP/COEP, SPA fallback (aset yang hilang dijawab 404), MIME WASM, cache (aset ter-hash `immutable`, `index.html` selalu `no-cache`), dan negosiasi `.br` → `.gz` → mentah.

Catatan: server ini **HTTP polos**. Untuk dipakai publik, taruh di balik HTTPS (reverse proxy, Cloudflare Tunnel, dsb.) — selain untuk keamanan, Office ke PDF hanya aktif di konteks aman (HTTPS atau `localhost`). Karena sekarang ada proses yang harus hidup, pasang service manager (`systemd`, `pm2`, dsb.) bila dipakai serius.

### Cara 2 — nginx atau Caddy di VPS sendiri

Build lalu unggah `dist/` ke server, misalnya ke `/var/www/privapdf`:

```bash
npm run setup:office   # aset WASM + .gz/.br (wajib tiap deploy: public/wasm gitignored)
npm run build          # tsc + vite build + pemeriksaan dist
rsync -a --delete dist/ user@server:/var/www/privapdf/
```

`nginx` (`/etc/nginx/conf.d/privapdf.conf`):

```nginx
server {
    listen 80;
    server_name contoh-domain-anda.com;      # ganti dengan domainmu
    root /var/www/privapdf;
    index index.html;

    add_header Cross-Origin-Opener-Policy same-origin always;
    add_header Cross-Origin-Embedder-Policy require-corp always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header X-Frame-Options DENY always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    gzip_static on;                          # menyajikan .gz hasil setup:office

    location / {
        try_files $uri $uri/ /index.html;    # SPA fallback untuk rute halaman
    }

    location = /index.html {
        expires epoch;                       # Cache-Control: no-cache — jangan pakai add_header
    }                                        # di sini: itu membuang header level server

    location ~ ^/(assets|wasm|models|imgly)/ {
        try_files $uri =404;                 # aset hilang → 404, bukan index.html
    }
}
```

`Caddy` (Caddyfile):

```caddyfile
contoh-domain-anda.com {
    root * /var/www/privapdf
    @page not path /assets/* /wasm/* /models/* /imgly/*
    try_files @page {path} /index.html       # aset hilang tetap 404
    header {
        Cross-Origin-Opener-Policy same-origin
        Cross-Origin-Embedder-Policy require-corp
        X-Content-Type-Options nosniff
        Referrer-Policy strict-origin-when-cross-origin
        X-Frame-Options DENY
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
    }
    file_server {
        precompressed gzip br
    }
}
```

Caddy otomatis mengurus HTTPS. Untuk nginx + HTTPS, letakkan sertifikat (certbot) seperti biasa. Jika mengaktifkan brotli statis (`brotli_static on;` atau Caddy `precompressed br`), pengunjung mendapat unduhan ±50 MB alih-alih ±75 MB.

### Cara 3 — Cloudflare Pages / Vercel / Netlify (host statis gratis)

Repo sudah menyertakan `public/_headers`, `public/_redirects`, dan `vercel.json` — COOP/COEP, header keamanan, dan SPA fallback ikut otomatis. Build command `npm run build`, output `dist`. Catatan: fallback bawaan platform ini juga menjawab `index.html` untuk aset yang hilang; bila setelah deploy muncul galat memuat chunk, refresh halaman.

**Batasan keras:** platform Pages menolak berkas statis > 25 MB, sedangkan aset Office 237 MB. Hapus dulu sebelum build:

```bash
rm -rf public/wasm/office
npm run build
```

Hasilnya semua tool jalan **kecuali Office ke PDF**. Memunculkannya kembali butuh hosting aset terpisah + perubahan kode — tidak disarankan untuk pemula.

### Fitur vs syarat hosting

| Fitur | Syarat |
| --- | --- |
| 19 tool PDF/gambar | Hosting statis biasa — tanpa syarat khusus |
| Hapus latar (AI) | Aset model ter-host; Cache API butuh konteks aman (tanpa itu model terunduh ulang tiap sesi, tetap jalan) |
| Office ke PDF | Aset WASM ter-host + **konteks aman (HTTPS/localhost) + header COOP/COEP** + browser modern (Chrome/Edge/Firefox terbaru). Webview/pratinjau tersemat tidak didukung — aplikasi menolak dengan pesan jelas, bukan menggantung |

### Pemeriksaan hasil build (`scripts/check-dist.mjs`)

`npm run build` **menolak** hasil yang akan rusak di produksi: ada `.ts`/`.tsx` mentah di `dist/`, aset merujuk `assets/*.ts`, `new Worker(<var>)` berisi `data:` URL, atau chunk worker hilang. Ini nyata: bug worker pernah lolos `tsc`, lolos seluruh test, dan lolos uji manual di dev — lalu mati begitu di-deploy. `npm run check:dist` menjalankan pemeriksaan yang sama tanpa build penuh.

### Verifikasi setelah deploy

```bash
curl -sI https://domain-anda.com/ | grep -i cross-origin                 # COOP/COEP tampil
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' \
  https://domain-anda.com/wasm/office/soffice.wasm                       # 200 application/wasm
curl -s -o /dev/null -w '%{http_code}\n' \
  https://domain-anda.com/assets/tidak-ada.js                            # 404 (bukan 200)
curl -s https://domain-anda.com/ | grep -c googleapis                    # harus 0
```

## Pengembangan

| Perintah | Fungsi |
| --- | --- |
| `npm run dev` | Dev server (sudah dengan header COOP/COEP untuk WASM) |
| `npm run serve` | Sajikan `dist/` produksi di satu port (lihat Cara 1) |
| `npm run setup:office` | Salin aset Office WASM + patch timeout + siapkan `.gz`/`.br` (opsional) |
| `npm run setup:models` | Unduh model AI hapus latar + runtime ONNX (opsional) |
| `npm run setup:imgly` | Unduh aset imgly background-removal (opsional) |
| `npm run check` | Type-check TypeScript |
| `npm run check:dist` | Periksa `dist/` tanpa build penuh (aturan worker & `.ts` mentah) |
| `npm test` | Seluruh test (vitest) |
| `npm run build` | Build produksi ke `dist/` + periksa hasil build |
| `npm audit` | Cek kerentanan dependensi |

Validasi wajib sebelum push: `npm run check`, `npm test`, `npm audit` (0 kerentanan).

**Dev lewat tunnel/domain sendiri:** Vite menolak `Host` tak dikenal (proteksi DNS rebinding). Isi env var `VITE_ALLOWED_HOSTS` (pisahkan dengan koma), mis. `VITE_ALLOWED_HOSTS=dev.domainku.com npm run dev` — jangan ganti dengan `allowedHosts: true`.

**Aturan worker yang dijaga `check-dist`:** `new URL(...)` wajib inline di dalam `new Worker(...)`. Disimpan ke variabel dulu = Vite memperlakukannya sebagai aset biasa, `.ts` mentah ikut ke dist, worker mati di produksi.

```ts
// benar — Vite membundelnya jadi chunk worker ter-hash
new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

// salah — Vite memperlakukannya sebagai aset biasa; .ts mentah ikut ke dist
const url = new URL('./worker.ts', import.meta.url);
new Worker(url, { type: 'module' });
```

### File yang tidak ikut repo (by design)

| Path | Alasan | Cara mendapatkan |
| --- | --- | --- |
| `public/wasm/office/` | Aset LibreOffice WASM 237 MB + salinan `.gz`/`.br` — GitHub menolak file > 100 MB | `npm run setup:office` |
| `public/models/bg/` | Model u2netp + runtime ONNX ±30 MB | `npm run setup:models` |
| `public/imgly/` | Aset @imgly/background-removal ±160 MB | `npm run setup:imgly` |
| `dist/` | Hasil build | `npm run build` |

## Privasi dan keamanan

Input berada di RAM tab browser; tidak ada akun, telemetry, atau upload aplikasi. Password PDF hanya berada di memori dan dibersihkan saat sesi berakhir. Session dibersihkan saat workspace unmount, `pagehide`, dan `beforeunload`, tetapi browser/OS tidak menjamin penghapusan fisik dari semua salinan memori. Jangan memproses dokumen yang membutuhkan kontrol DLP/forensik khusus. Output dibuat sebagai download lokal.

Laporan audit keamanan: [SECURITY-AUDIT.md](./SECURITY-AUDIT.md) (snapshot pada tanggal audit; fitur yang ditambah setelahnya belum tercakup).

## Troubleshooting

- **Office ke PDF menolak dengan pesan SharedArrayBuffer / crossOriginIsolated**: kamu membuka lewat webview/pratinjau tersemat atau situs tanpa HTTPS + COOP/COEP. Buka lewat browser biasa (Chrome/Edge/Firefox terbaru) via HTTPS atau `localhost`, dan pastikan penyaji mengirim kedua header tersebut.
- **Office lambat/gagal**: jalankan `npm run setup:office`, restart dev server. Pemakaian pertama memang mengunduh ±50 MB (brotli) + kompilasi WASM — progres tampil di layar; aset mulai diunduh begitu file dipilih, jadi jeda sebentar sebelum menekan tombol konversi mempercepat. Batas konversi 10 menit.
- **Proses tampak berhenti**: bila tidak ada kemajuan ±20 detik, aplikasi menampilkan petunjuk muat ulang di baris status — refresh halaman lalu ulangi.
- **Build ditolak `scripts/check-dist.mjs`**: ada worker yang tidak dikenali Vite. Perbaiki dengan pola `new Worker(new URL(...))` **inline** (lihat Pengembangan). Jangan dipaksa deploy — fiturnya mati hanya di produksi.
- **"Blocked request. This host is not allowed"**: jalankan ulang dev server dengan `VITE_ALLOWED_HOSTS=domainmu npm run dev`.
- **Deep link 404**: pastikan SPA fallback aktif (`try_files $uri $uri/ /index.html` di nginx; `_redirects`/`vercel.json` di platform Pages).
- **Aset `.ts` disajikan sebagai `video/mp2t`**: pemetaan bawaan nginx — yang salah adalah `.ts` mentah ikut ke `dist/`; `scripts/check-dist.mjs` yang mencegahnya.
- **File ditolak**: file rusak atau ekstensi tidak cocok sengaja ditolak (magic bytes diverifikasi). Penolakan juga terjadi bila melewati batas sesi (50 MB per file, 10 file, total 120 MB).
- **Office ke PDF menolak file Excel**: pastikan ekstensinya `.xls`/`.xlsx` — file tanpa ekstensi dan tanpa tipe MIME dari browser tidak bisa dikenali.
- **PDF ke gambar: "halaman terlalu besar"**: canvas melewati batas browser pada resolusi tinggi. Pilih resolusi Standar (1x) atau Tinggi (2x).
- **Drag tidak jalan di HP**: tahan kartu ±0,25 detik sampai terlihat "terangkat", baru seret.
- **Isi formulir kosong**: PDF bukan AcroForm (tidak punya field). Gunakan tanda tangan untuk mengisi manual, atau flatten untuk mengunci anotasi.
- **Aset lama saat deploy**: chunk versi lama yang sudah tidak ada dijawab 404 oleh `npm run serve` (dan konfigurasi nginx/Caddy di atas). Bila tampilan masih lama, unregister service worker lalu reload.

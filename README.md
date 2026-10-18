# PrivaPDF

Tools PDF yang **100% diproses lokal di browser** (React + Vite + WASM) — tanpa akun, tanpa upload, tanpa telemetry. File tidak pernah meninggalkan perangkat pengguna. Tersedia 27 tool: PDF (gabung/split/rotate/…), edit teks, kompres, sensor dan bersihkan data tersembunyi, OCR PDF hasil scan, formulir, tanda tangan, toolkit gambar, tanda air gambar, hapus latar, Office ke PDF.

Lisensi: **AGPL-3.0-or-later** (code) — dipakai karena tool "Hapus latar" memakai `@imgly/background-removal` yang berlisensi AGPL-3.0; model AI lain (U²-Net/ISNet via rembg) berlisensi Apache-2.0. OCR memakai `tesseract.js` (Apache-2.0) dengan data bahasa dari paket `@tesseract.js-data` (MIT).

## Daftar Tool (27)

| Tool | Fungsi |
| --- | --- |
| Gabungkan PDF | Merge beberapa PDF, atur urutan visual per halaman/per file |
| Pisahkan PDF | Ekstrak halaman terpilih, per rentang, atau per kelompok |
| Hapus halaman | Buang halaman yang tidak diinginkan |
| Urutkan ulang | Susun ulang halaman via drag & drop |
| Putar halaman | Rotasi semua atau halaman terpilih |
| Nomor halaman | Posisi, format (angka/romawi), font, offset |
| Tanda air | Teks atau gambar; center, tile, posisi, custom font TTF/OTF |
| Halaman per lembar | 2 atau 4 halaman per lembar, atau buklet lipat tengah (dilengkapi halaman kosong sampai kelipatan 4); mengikuti rotasi & potongan halaman |
| Potong halaman | Margin custom, global atau per halaman |
| Kompres PDF | Ringan: object streams + bersih-bersih metadata. Sedang/Kuat: render ulang halaman jadi JPEG (144/108 dpi), hasil tidak diunduh bila malah lebih besar |
| Hapus proteksi | Buka PDF terenkripsi (user/owner password) via qpdf |
| Beri password | Enkripsi AES-256, dengan password pemilik opsional |
| Edit metadata | Judul, penulis, subjek, kata kunci, pembuat — XMP ditulis ulang dari nilai baru (identitas PDF/A dipertahankan) dan info revisi lama ikut dibuang |
| Edit teks PDF | Ubah baris teks atau tambah teks baru. Operator teks asli dibuang dari content stream (diganti TJ kosong selebar aslinya agar teks lain tidak bergeser), teks baru memakai font/ukuran/warna/sudut asli — termasuk tebal/miring dari nama font, FontDescriptor, maupun bold sintetis (render mode stroke) — teks pengganti marked content (/ActualText, /Alt, /E) dan elemen strukturnya ikut dibersihkan, file ditulis ulang qpdf, lalu hasil diverifikasi pdf.js. Baris yang hanya teks OCR tak terlihat di atas scan ditolak (gambarnya tidak bisa diedit — pakai Sensor PDF). Ada mode layar penuh untuk menyunting |
| Sensor PDF | Gambar kotak hitam per halaman; halaman tersensor dirender jadi gambar 144 dpi, halaman lain tetap teks. Hasil dibangun ulang tanpa anotasi/bookmark/metadata, resource bersama dipangkas via qpdf |
| Bersihkan PDF | Buang info dokumen, XMP, PieceInfo, lampiran & berkas tertanam (juga yang masih dirujuk komentar/struktur), paket XFA, JavaScript (termasuk Rendition, 3D, RichMedia) & aksi otomatis, serta revisi lama (ditulis ulang via qpdf); isi, tautan, formulir, bookmark tetap. Formulir XFA dinamis ditolak karena isinya hanya ada di XFA |
| Isi formulir | Isi field AcroForm (teks, checkbox, dropdown) + pratinjau |
| Ratakan (flatten) | Kunci formulir/anotasi jadi konten statis; anotasi tanpa tampilan yang tidak bisa diratakan dibuang (tautan tetap). PDF terkunci harus dibuka dulu |
| PDF ke gambar | PNG/JPEG per halaman — terpisah atau satu ZIP |
| OCR PDF hasil scan | tesseract.js (Indonesia + Inggris) → lapisan teks tak terlihat sehingga PDF bisa dicari/disalin, atau unduh .txt; halaman yang sudah berisi teks dilewati (butuh aset ±16 MB — lihat Opsional 3) |
| Ekstrak teks | Semua teks ke file .txt |
| Tanda tangan / stempel | Gambar tangan di canvas atau unggah PNG/JPG, tempel per halaman |
| Gambar ke PDF | PNG/JPEG → PDF |
| Toolkit gambar | Kompres, resize massal, konversi PNG/JPEG/WebP; re-encode menghapus EXIF |
| Tanda air gambar | Teks atau logo di foto PNG/JPEG/WebP, banyak sekaligus (ZIP); opsi sama dengan tanda air PDF |
| Hapus latar | AI 4 varian — u2netp, ISNet quint8/fp16/fp32, semuanya lokal di browser — atau mode warna solid → PNG transparan; latar hasil bisa tetap transparan atau diganti warna (putih/merah/biru untuk pas foto, atau warna bebas) |
| Office ke PDF | DOCX/DOC, XLSX/XLS, PPTX/PPT, ODT/ODS/ODP, RTF, CSV, HTML (butuh aset engine ±237 MB — lihat Opsional 1) |

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

Buka `http://localhost:5173` — sebagian besar tool langsung jalan. **Kecuali "Office ke PDF"**, **varian AI "Hapus latar"**, dan **OCR**, karena asetnya sengaja tidak ikut repo — aktifkan dengan langkah opsional di bawah. Ketiganya hanya butuh aset: tidak ada flag, semacam "mode aktif", atau konfigurasi lain — begitu aset ada, toolnya jalan.

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
npm run setup:models   # u2netp (Apache-2.0, ±4 MB) + runtime ONNX → public/models/bg/ (±40 MB)
npm run setup:imgly    # aset @imgly/background-removal (AGPL-3.0) → public/imgly/ (±330 MB, 3 varian ISNet)
```

- **Maksimal (imgly)** — ISNet fp32 ±168 MB. Paling akurat, unduhan paling berat.
- **Seimbang (imgly)** — ISNet fp16 ±84 MB. Default tool.
- **Ringan (imgly)** — ISNet quint8 ±42 MB.
- **Cepat** — u2netp ±4 MB; tidak memakai imgly, jalur onnxruntime-web sendiri.
- Runtime ONNX (±11 MB, satu varian saja — `ort-wasm-simd-threaded.wasm`; ±22 MB bila WebGPU yang dipakai) ikut terunduh pada pemakaian AI pertama; setelah itu hanya varian yang dipilih, dan hanya sekali per browser (Cache API).
- Tanpa langkah ini, tab "Warna solid" pada tool Hapus latar tetap berfungsi.

### Opsional 3: OCR (aset ±16 MB)

```bash
npm run setup:ocr      # tesseract.js + data bahasa Indonesia & Inggris → public/tesseract/
```

Menyalin dari `node_modules` (tanpa unduhan tambahan): worker, tiga varian core WASM LSTM (browser hanya mengunduh satu, ±3,9 MB), serta data bahasa `best_int` Indonesia ±1,2 MB dan Inggris ±2,9 MB. Pemakaian pertama di browser mengunduh ±8 MB; data bahasa lalu disimpan tesseract.js di IndexedDB. Tanpa langkah ini HANYA tool OCR yang tidak jalan — tool itu menampilkan pesan bahwa asetnya belum dipasang.

Jalankan ulang setelah `npm ci` yang menaikkan versi `tesseract.js`: worker dan core di `public/tesseract/` harus sama versinya dengan pustaka yang dibundel.

## Deploy — pilih salah satu cara

Hasil build adalah **situs statis murni** (`dist/`) — tidak ada backend, tidak ada database. Yang dibutuhkan penyaji:

1. **Header COOP/COEP** (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`) — **wajib** untuk Office ke PDF; tanpanya browser tidak memberi SharedArrayBuffer dan fitur itu mati.
2. **SPA fallback** — rute halaman tak dikenal (mis. `/tools/merge`) menjawab `index.html` (status 200, `Cache-Control: no-cache`). **Aset yang hilang** (`/assets/`, `/wasm/`, `/models/`, `/imgly/`, `/tesseract/`, atau path berekstensi) sebaiknya **404**, bukan `index.html` — kalau tidak, tab lama yang meminta chunk versi sebelumnya menerima HTML yang tersimpan di cache sebagai aset.
3. **MIME benar** — `.wasm` sebagai `application/wasm`; jangan menyajikan berkas `.ts` mentah.

### Cara 1 — server bawaan `npm run serve` (paling simpel, tanpa nginx/Caddy)

```bash
npm run build
npm run serve                  # mendengarkan di http://0.0.0.0:8080
PORT=9000 npm run serve        # port lain
HOST=127.0.0.1 npm run serve   # hanya lokal
```

Server kecil tanpa dependensi (`scripts/serve-dist.mjs`) sudah mengurus semuanya: header keamanan + COOP/COEP, SPA fallback (aset yang hilang dijawab 404), MIME WASM, cache (aset ter-hash `immutable`, `index.html` selalu `no-cache`), dan negosiasi `.br` → `.gz` → mentah.

Catatan: server ini **HTTP polos**. Untuk dipakai publik, taruh di balik HTTPS (reverse proxy, Cloudflare Tunnel, dsb.) — selain untuk keamanan, Office ke PDF hanya aktif di konteks aman (HTTPS atau `localhost`).

**Menjalankan permanen dengan systemd.** Contoh unit ada di [`systemd/privapdf.service`](./systemd/privapdf.service). Salin ke `/etc/systemd/system/`, sesuaikan `WorkingDirectory`, `ExecStart`, dan `PORT`, lalu:

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now privapdf
```

Deploy ulang setelah pull/perubahan cukup `npm run build && sudo systemctl restart privapdf` — server menyajikan `dist/` langsung dari disk, tanpa rsync ke web root. Aset `setup:*` (folder `public/` yang di-gitignore) tetap tersimpan di antara pull, jadi cukup dijalankan sekali di server — ulangi hanya bila `npm ci` menaikkan versi paketnya. Bila mesin yang sama juga menjalankan reverse proxy atau Cloudflare Tunnel, set `HOST=127.0.0.1` supaya port itu tidak terbuka ke jaringan: proxy/Tunnel tetap bisa menghubungi `http://127.0.0.1:<PORT>`, dan reverse proxy **tidak boleh** menambahkan header keamanan/COOP/COEP sendiri (server asal sudah mengirimnya — header kembar membuat COOP/COEP tidak sah).

### Cara 2 — nginx atau Caddy di VPS sendiri

Build lalu unggah `dist/` ke server, misalnya ke `/var/www/privapdf`:

```bash
npm run setup:office   # aset WASM + .gz/.br (public/wasm gitignored — wajib di salinan baru)
npm run setup:ocr      # aset OCR (public/tesseract gitignored)
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

    location ~ ^/(assets|wasm|models|imgly|tesseract)/ {
        try_files $uri =404;                 # aset hilang → 404, bukan index.html
    }
}
```

`Caddy` (Caddyfile):

```caddyfile
contoh-domain-anda.com {
    root * /var/www/privapdf
    @page not path /assets/* /wasm/* /models/* /imgly/* /tesseract/*
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

Platform ini hanya menjalankan build command, bukan `setup:*`. Agar OCR ikut, pakai build command `npm run setup:ocr && npm run build` — asetnya disalin dari `node_modules` dan tiap berkasnya di bawah 4 MB.

**Batasan keras:** platform Pages menolak berkas statis > 25 MB, sedangkan aset Office 237 MB. Hapus dulu sebelum build:

```bash
rm -rf public/wasm/office
npm run build
```

Hasilnya semua tool jalan **kecuali Office ke PDF**. Memunculkannya kembali butuh hosting aset terpisah + perubahan kode — tidak disarankan untuk pemula.

### Fitur vs syarat hosting

| Fitur | Syarat |
| --- | --- |
| 24 tool PDF/gambar (termasuk Edit teks, Sensor, Bersihkan, Kompres, Halaman per lembar) | Hosting statis biasa — tanpa syarat khusus |
| OCR PDF hasil scan | Aset `public/tesseract/` ter-host (`npm run setup:ocr`); tanpa header khusus |
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
curl -s -o /dev/null -w '%{http_code}\n' \
  https://domain-anda.com/tesseract/worker.min.js                        # 200 bila OCR dipasang
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
| `npm run setup:ocr` | Salin aset OCR tesseract.js + data bahasa (opsional) |
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
| `public/models/bg/` | Model u2netp + runtime ONNX ±40 MB | `npm run setup:models` |
| `public/imgly/` | Aset @imgly/background-removal ±330 MB (3 varian ISNet) | `npm run setup:imgly` |
| `public/tesseract/` | Aset OCR tesseract.js ±16 MB | `npm run setup:ocr` |
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
- **OCR: "Mesin OCR gagal dimuat"**: aset `public/tesseract/` belum ada di server — jalankan `npm run setup:ocr` lalu build ulang. Hasil kurang akurat biasanya karena scan buram, miring, atau beresolusi rendah; OCR hanya mengenali bahasa Indonesia dan Inggris.
- **OCR melewati halaman**: halaman yang sudah berisi ≥100 karakter teks dianggap sudah punya lapisan teks dan tidak di-OCR, agar teks tidak dobel.
- **Anotasi berbeda di hasil Kompres (Sedang/Kuat), PDF ke gambar, atau Sensor**: halaman dirender mengikuti tampilan cetak — anotasi tanpa flag Print tidak ikut, anotasi khusus cetak ikut. Ini disengaja agar render tetap berjalan saat tab tidak aktif; pratinjau Sensor memakai tampilan yang sama.
- **Kompres Sedang/Kuat tidak mengunduh apa pun**: hasilnya lebih besar dari file asli (PDF berisi teks/vektor), jadi tidak diunduh — pakai tingkat Ringan.
- **Edit teks: hurufnya berganti jadi Helvetica/Times/Courier**: font di PDF biasanya subset yang hanya memuat huruf teks aslinya. Bila teks baru butuh huruf lain, dipakai font standar bergaya sama (sans/serif/mono, tebal/miring — dibaca dari nama font, `/FontWeight`, dan flag `ForceBold`/`Italic`); karakter di luar WinAnsi ditulis `?`.
- **Edit teks: "Baris ini teks OCR tak terlihat…"**: halaman hasil scan; teks yang terlihat ada di gambar, sedangkan baris yang bisa diklik hanya lapisan OCR tak terlihat di atasnya. Mengedit lapisan itu tidak mengubah gambar, jadi ditolak. Tutup datanya dengan Sensor PDF.
- **Edit teks: "teks lama masih terbaca" atau "teks lain ikut berubah"**: hasil diperiksa ulang dengan pdf.js setelah disimpan. Penyebab umumnya teks di dalam Form XObject (mis. hasil Halaman per lembar) atau satu operator teks yang membentang ke luar baris. Untuk data sensitif pakai Sensor PDF.
- **Hasil Sensor tanpa tautan, komentar, atau bookmark**: disengaja — rantai anotasi bisa membawa data dari halaman yang disensor.
- **PDF ke gambar: "halaman terlalu besar"**: canvas melewati batas browser pada resolusi tinggi. Pilih resolusi Standar (1x) atau Tinggi (2x).
- **Drag tidak jalan di HP**: tahan kartu ±0,25 detik sampai terlihat "terangkat", baru seret.
- **Isi formulir kosong**: PDF bukan AcroForm (tidak punya field). Gunakan tanda tangan untuk mengisi manual, atau flatten untuk mengunci anotasi.
- **Aset lama saat deploy**: chunk versi lama yang sudah tidak ada dijawab 404 oleh `npm run serve` (dan konfigurasi nginx/Caddy di atas). Bila tampilan masih lama, unregister service worker lalu reload.

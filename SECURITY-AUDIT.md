# Laporan Audit Keamanan — PrivaPDF

- **Tanggal**: 2026-09-27
- **Profil**: quick (client-side SPA, satu permukaan hosting statis)
- **Target**: seluruh repo (src/, public/, wasm/, konfigurasi build & hosting, dependensi, riwayat git)
- **Status**: 4 temuan dikonfirmasi & diperbaiki, 1 catatan arsitektural, 1 kandidat ditolak.

## Ringkasan

PrivaPDF adalah SPA 100% client-side (React + Vite, qpdf/LibreOffice WASM) tanpa backend:
tidak ada SQL, endpoint, autentikasi, atau server-side input. Permukaan serangan nyata:
CSP & header, service worker (PWA), pipeline dependensi, dan penanganan file/ZIP di sisi klien.
Hasil audit: kode aplikasi bersih (tidak ada `innerHTML`/`eval`/`Function`, tidak ada secrets
di git history, password PDF hanya di memori dan di-nol-kan saat sesi berakhir). Masalah
berada di konfigurasi hosting/SW dan dependensi.

## Temuan yang diperbaiki

### F1 (moderate) — react-router rentan open redirect & constructor injection
- **Bukti**: `npm audit` — GHSA-wrjc-x8rr-h8h6 (CWE-601) dan GHSA-337j-9hxr-rhxg (CWE-470),
  keduanya dipatch hanya di `react-router >= 7.18.0`; terpasang 6.30.4.
- **Perbaikan**: `react-router-dom` 6.30.4 → **7.18.4** (major). App hanya memakai
  `BrowserRouter/Routes/Route/Link/Outlet/useParams` (semua tak berubah di v7) dan sudah
  mengaktifkan kedua future-flag v7, sehingga satu-satunya perubahan kode adalah
  menghapus prop `future` di `src/App.tsx`. Diverifikasi: `tsc` lulus, 134 test lulus,
  smoke test browser pada `/`, `/tools/unlock` render normal.

### F2 (moderate, dev-only) — vitest path traversal via @vitest/mocker
- **Bukti**: `npm audit` — GHSA-82fw-gwwq-j7x9 (arbitrary file read pada test runner).
- **Perbaikan**: `vitest` & `@vitest/coverage-v8` 4.1.10 → **4.1.11**.
- `npm audit` kini: **0 vulnerabilities**.

### F3 (low, privasi) — setiap pengunjung dikirim ke Google Fonts
- **Bukti**: `index.html` memuat stylesheet `fonts.googleapis.com` + preconnect
  `fonts.gstatic.com` untuk Nunito (font utama UI, lihat `--font-sans` di `src/index.css`),
  sementara font lain (DM Sans/DM Mono/Playfair) sudah self-hosted di `public/fonts/`.
  Pada aplikasi yang menjanjikan "tanpa telemetry / 100% lokal" (README, halaman Privacy),
  request pihak ketiga ini membocorkan IP+UA pengunjung ke Google sebelum JS berjalan,
  dan memperluas CSP (`style-src`, `font-src`) ke origin luar.
- **Perbaikan**: Nunito di-self-host sebagai variable font — `public/fonts/nunito-latin.woff2`
  (39 KB, 1 file mencakup weight 400–900, subset latin), `@font-face` di `src/index.css`,
  3 tag Google dihapus dari `index.html`, dan CSP diperketat: `style-src 'self' 'unsafe-inline'`,
  `font-src 'self'`. Diverifikasi di browser: `document.fonts.check('700 16px Nunito') === true`,
  nol link eksternal di `<head>`.

### F4 (low, integritas cache) — service worker meng-cache HTML sebagai JS/WASM
- **Bukti**: `public/sw.js` (SHELL v3) pre-cache 5 URL `/wasm/office/*` yang tidak ada di
  repo (artifact LibreOffice WASM memang belum disertakan — diakui di halaman Privacy).
  SPA fallback (`_redirects` / vercel.json rewrite) menjawab path itu dengan
  **200 OK `text/html`** (diverifikasi: `curl /wasm/office/soffice.js` → `200 text/html`),
  sehingga `cache.addAll()` berhasil dan cache SW berisi HTML tersamar sebagai JS/WASM.
  Fetch handler lama juga meng-cache respons `ok` apa pun tanpa cek content-type, jadi
  percobaan runtime pun ikut meracuni cache.
- **Perbaikan** (`public/sw.js`): SHELL hanya berisi file yang benar-benar ada
  (`/`, `/index.html`, `/manifest.webmanifest`, `/icon.svg`); fetch handler menolak
  meng-cache respons `text/html` untuk request non-navigasi; versi cache dinaikkan ke
  `privapdf-shell-v4` agar cache lama yang sudah tercemar terhapus saat aktivasi.
  Regresi dikunci oleh test baru di `tests/pwa/pwa-assets.test.ts` (setiap entri SHELL
  harus ada di disk + guard HTML). Fitur office-to-pdf tidak berubah sifatnya: memang
  belum aktif sejak awal (lihat Catatan di bawah).

## Catatan arsitektural (tidak diubah)

- **Office WASM (250 MB) belum disertakan** — keputusan produk yang sudah didokumentasikan
  sendiri di `src/pages/Privacy.tsx` ("belum aktif karena artifact LibreOffice WASM belum
  disertakan"). Jika suatu saat ingin diaktifkan: salin
  `node_modules/@matbee/libreoffice-converter/wasm/{soffice.js,soffice.wasm,soffice.data,soffice.worker.js}`
  dan `dist/browser.worker.global.js` → `public/wasm/office/{... , browser.worker.js}`
  (folder `public/wasm` sudah di-gitignore), baru tambahkan URL-nya kembali ke SHELL —
  guard `text/html` di SW kini mencegah kekambuhan cache poisoning.
- README §"Tool aktif" masih menyebut Office ke PDF aktif; kenyataannya belum (halaman
  Privacy yang benar). Sebaiknya README diselaraskan oleh pemilik.

## Kandidat yang ditolak

- **Zip-slip via nama file output**: nama masuk ZIP berasal dari `file.name` yang sudah
  melalui `safeName()` (menghapus `/ \ ..` leading & karakter kontrol), dan `File.name`
  berasal dari disk pengguna sendiri (tidak mengandung pemisah path). Dampaknya
  self-impact tanpa aktor lintas batas → bukan temuan.

## Yang sudah baik (tidak perlu diubah)

- CSP `script-src 'self'` tanpa `unsafe-inline/eval`; semua WASM (qpdf, LibreOffice, pdf.js)
  berjalan di worker same-origin, bukan di dokumen.
- Validasi berlapis di trust boundary file: allowlist MIME/ekstensi, magic bytes,
  batas 10 file / 50 MB / 120 MB (`src/lib/validation.ts`, `file-session.ts`).
- Worker message protocol divalidasi (`isJobRequest`); timeout & terminate di sisi klien.
- Password PDF tidak pernah disimpan/log; buffer input di-nol-kan saat sesi berakhir
  (`clearSession`).
- Tidak ada secrets di riwayat git, tidak ada file `.env`.
- Header `X-Frame-Options: DENY`, COOP/COEP, `nosniff`, Permissions-Policy ada di
  `public/_headers`.

## Verifikasi

- `npm audit` → 0 vulnerabilities.
- `npm run check` (tsc) → lulus.
- `npm test` → 134/134 lulus (termasuk 2 test PWA baru).
- `npm run build` → berhasil; dist berisi CSP baru, `fonts/nunito-latin.woff2`, SW v4.
- Smoke test browser (vite preview): `/` dan `/tools/unlock` render normal, font Nunito
  termuat, tidak ada request pihak ketiga.

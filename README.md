# PrivaPDF

## Install dan development

```bash
npm ci
npm run dev
```

Buka URL Vite yang ditampilkan. Semua file diproses lokal di browser dan tidak diunggah.

## Production

```bash
npm run check
npm run test
npm run build
```

Deploy isi `dist/` ke Cloudflare Pages. File `public/_redirects` menyediakan SPA fallback. Header COOP/COEP di `public/_headers` wajib dipertahankan agar Office WASM dapat berjalan (`Cross-Origin-Opener-Policy: same-origin` dan `Cross-Origin-Embedder-Policy: require-corp`).

## Fitur dan batasan

Tool aktif: merge PDF, split halaman, rotate PDF, gambar PNG/JPEG ke PDF, dan Office ke PDF melalui LibreOffice WASM. PDF-to-image masih berupa capability gate dan belum mengekspor gambar. Go WASM di `wasm/go` belum di-wire ke aplikasi dan bukan engine aktif.

Office WASM diunduh/dimuat pada pemakaian pertama dan dapat membutuhkan waktu serta memori besar. Browser harus mendukung WebAssembly, Worker, dan `crossOriginIsolated`. Validasi memeriksa ukuran, MIME/ekstensi, dan magic bytes; batas sesi adalah 10 file, 50 MB per file, dan 120 MB total.

## Privasi dan keamanan

Input berada di RAM tab browser; tidak ada akun, telemetry, atau upload aplikasi. Session dibersihkan saat workspace unmount, `pagehide`, dan `beforeunload`, tetapi browser/OS tidak menjamin penghapusan fisik dari semua salinan memori. Jangan memproses dokumen yang membutuhkan kontrol DLP/forensik khusus. Output dibuat sebagai download lokal.

## Troubleshooting

- Office gagal: pastikan situs HTTPS, header COOP/COEP aktif, cache service worker diperbarui, dan browser mendukung WASM/Worker.
- Deep link 404: deploy `dist/` sebagai Cloudflare Pages dan jangan menghapus `_redirects`.
- File ditolak: periksa ekstensi dan isi file; file rusak atau ekstensi yang tidak cocok sengaja ditolak.
- Jika service worker menyajikan aset lama, unregister service worker lalu reload setelah deployment.

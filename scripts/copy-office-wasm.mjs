// Salin aset LibreOffice WASM (~250 MB) dari node_modules ke public/wasm/office
// agar fitur "Office ke PDF" berjalan di development.
//
// Catatan: folder public/wasm di-gitignore dan TIDAK untuk production —
// Cloudflare Pages menolak file statis di atas 25 MB (soffice.wasm 147 MB,
// soffice.data 99 MB). Hapus public/wasm/office sebelum `npm run build`
// untuk deploy ke host statis.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { constants as zlibConstants, createBrotliCompress, createGzip } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'node_modules', '@matbee', 'libreoffice-converter');
const dest = join(root, 'public', 'wasm', 'office');
mkdirSync(dest, { recursive: true });

const files = [
  ['wasm/soffice.js', 'soffice.js'],
  ['wasm/soffice.wasm', 'soffice.wasm'],
  ['wasm/soffice.data', 'soffice.data'],
  ['wasm/soffice.worker.js', 'soffice.worker.js'],
  ['dist/browser.worker.global.js', 'browser.worker.js'],
];

let copied = 0;
for (const [from, to] of files) {
  const target = join(dest, to);
  if (existsSync(target)) continue; // idempoten — jangan salin ulang 250 MB
  copyFileSync(join(src, from), target);
  console.log('disalin:', to);
  copied++;
}
if (!copied) console.log('aset sudah ada, dilewati.');

// Patch batas waktu inisialisasi WASM di salinan browser.worker.js.
// Vendor meng-hardcode 12e4 (2 menit) — mustahil muat saat aset 246 MB diambil
// melalui tunnel/home server dengan upload terbatas. Naikkan ke 6e5 (10 menit).
const workerPath = join(dest, 'browser.worker.js');
const original = '"WASM initialization timeout")),12e4)';
const patched = '"WASM initialization timeout")),6e5)';
let code = readFileSync(workerPath, 'utf8');
if (code.includes(original)) {
  writeFileSync(workerPath, code.replace(original, patched));
  console.log('patch: batas waktu inisialisasi WASM 2 menit → 10 menit');
} else if (code.includes(patched)) {
  console.log('patch: sudah diterapkan, dilewati.');
} else {
  console.warn('patch: pola timeout tidak ditemukan — package mungkin berubah, periksa manual.');
}

// Sediakan salinan .gz untuk nginx `gzip_static` (lihat /etc/nginx/conf.d/privapdf.conf).
// 237 MB → ~74 MB, dan yang penting: soffice.wasm turun di bawah batas 100 MB
// Cloudflare sehingga bisa di-cache di edge.
//
// Wajib berjalan SETELAH patch di atas — kalau tidak, .gz akan memuat
// browser.worker.js versi belum-terpatch dan batas 2 menit itu kembali berlaku.
const gzipTargets = ['soffice.wasm', 'soffice.data', 'soffice.js', 'browser.worker.js', 'soffice.worker.js'];
for (const name of gzipTargets) {
  const source = join(dest, name);
  const target = source + '.gz';
  if (!existsSync(source)) continue;
  if (existsSync(target) && statSync(target).mtimeMs >= statSync(source).mtimeMs) {
    console.log('gzip: sudah terbaru, dilewati —', name);
    continue;
  }
  const size = statSync(source).size;
  const started = Date.now();
  await pipeline(createReadStream(source), createGzip({ level: 6 }), createWriteStream(target));
  const gz = statSync(target).size;
  const mb = (n) => (n / 1048576).toFixed(1);
  console.log(`gzip: ${name} ${mb(size)} MB → ${mb(gz)} MB (${((gz / size) * 100).toFixed(1)}%) ${Date.now() - started}ms`);
}

// Salinan .br (brotli) — untuk wasm/data biner 15-25% lebih kecil dari .gz,
// jadi unduhan pertama aset 237 MB jadi lebih ringan lagi. Disajikan oleh
// scripts/serve-dist.mjs bila klien mengirim Accept-Encoding: br; nginx tanpa
// modul brotli mengabaikannya dan tetap memakai .gz. Kualitas 10 (bukan 11):
// ukuran nyaris sama, waktu kompresi ±2x lebih cepat pada 141 MB.
for (const name of gzipTargets) {
  const source = join(dest, name);
  const target = source + '.br';
  if (!existsSync(source)) continue;
  if (existsSync(target) && statSync(target).mtimeMs >= statSync(source).mtimeMs) {
    console.log('brotli: sudah terbaru, dilewati —', name);
    continue;
  }
  const size = statSync(source).size;
  const started = Date.now();
  const compressor = createBrotliCompress({
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 10,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: size,
    },
  });
  await pipeline(createReadStream(source), compressor, createWriteStream(target));
  const br = statSync(target).size;
  const mb = (n) => (n / 1048576).toFixed(1);
  console.log(`brotli: ${name} ${mb(size)} MB → ${mb(br)} MB (${((br / size) * 100).toFixed(1)}%) ${Date.now() - started}ms`);
}
console.log('Office WASM siap di public/wasm/office — restart dev server bila sedang berjalan.');

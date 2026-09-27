// Salin aset LibreOffice WASM (~250 MB) dari node_modules ke public/wasm/office
// agar fitur "Office ke PDF" berjalan di development.
//
// Catatan: folder public/wasm di-gitignore dan TIDAK untuk production —
// Cloudflare Pages menolak file statis di atas 25 MB (soffice.wasm 147 MB,
// soffice.data 99 MB). Hapus public/wasm/office sebelum `npm run build`
// untuk deploy ke host statis.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
console.log('Office WASM siap di public/wasm/office — restart dev server bila sedang berjalan.');

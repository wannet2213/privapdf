// Unduh model AI hapus latar opsi "Cepat" (u2netp ±4 MB, Apache-2.0 via rembg)
// + salin runtime WASM onnxruntime-web ke public/models/bg/.
// Kualitas lebih tinggi dilayani imgly (setup:imgly).
//
//   npm run setup:models
//
// Folder public/models/ di-gitignore (u2netp ±4 MB, ort ±25 MB).
// Idempoten: file yang sudah ada tidak diunduh ulang.
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dest = join(root, 'public', 'models', 'bg');
mkdirSync(dest, { recursive: true });

const MODELS = [
  ['u2netp.onnx', 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx'],
];

async function downloadTo(url, file) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} untuk ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
}

for (const [name, url] of MODELS) {
  const file = join(dest, name);
  if (existsSync(file)) {
    console.log('sudah ada, dilewati:', name);
    continue;
  }
  console.log('mengunduh:', name, '…');
  await downloadTo(url, file);
}

// Runtime WASM onnxruntime-web — disalin dari node_modules agar bebas CDN (CSP same-origin).
const ortDist = join(root, 'node_modules', 'onnxruntime-web', 'dist');
let copied = 0;
for (const f of readdirSync(ortDist)) {
  if (f.startsWith('ort-wasm-simd-threaded') && (f.endsWith('.wasm') || f.endsWith('.mjs'))) {
    copyFileSync(join(ortDist, f), join(dest, f));
    copied++;
  }
}
console.log(`Selesai: model + ${copied} file runtime ONNX di public/models/bg/`);
console.log('Muat ulang halaman lalu coba tool "Hapus latar" mode AI.');

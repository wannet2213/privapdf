// Unduh aset @imgly/background-removal (model ISNet fp32/fp16/quint8 + runtime
// ONNX, lisensi AGPL-3.0) dari CDN resmi imgly ke public/imgly/ agar self-host
// — CSP connect-src 'self' dan janji "tanpa pihak ketiga" tetap utuh.
//
//   npm run setup:imgly
//
// Folder public/imgly/ di-gitignored. Idempoten: chunk yang sudah ada
// dilewati. Hanya varian yang dipakai panel (fp16 ±22 MB, quint8 ±11 MB
// + runtime ONNX) — model fp32 /models/isnet (±170 MB) sengaja dilewati
// karena jalur "Maksimal" sudah dilayani ISNet Apache-2.0 milik sendiri.
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const SKIP = ['/models/isnet'];

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dest = join(root, 'public', 'imgly');
mkdirSync(dest, { recursive: true });

const VERSION = '1.7.0';
const BASE = `https://staticimgly.com/@imgly/background-removal-data/${VERSION}/dist/`;

async function download(url, file) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} untuk ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
}

const manifestUrl = BASE + 'resources.json';
const manifestFile = join(dest, 'resources.json');
console.log('mengunduh: resources.json');
const manifestRes = await fetch(manifestUrl);
if (!manifestRes.ok) throw new Error(`HTTP ${manifestRes.status} untuk ${manifestUrl}`);
const manifest = await manifestRes.json();
writeFileSync(manifestFile, JSON.stringify(manifest));

let total = 0;
let skipped = 0;
const pending = [];
for (const [key, entry] of Object.entries(manifest)) {
  if (SKIP.includes(key)) {
    console.log(`dilewati: ${key} (tidak dipakai panel)`);
    continue;
  }
  console.log(`resource ${key}: ${(entry.size / 1048576).toFixed(1)} MB (${entry.chunks.length} chunk)`);
  total += entry.size;
  for (const chunk of entry.chunks) {
    const file = join(dest, chunk.name);
    const expected = chunk.offsets[1] - chunk.offsets[0];
    // Lewati hanya bila utuh — unduhan yang pernah terhenti bisa menyisakan
    // chunk setengah jadi yang harus diambil ulang.
    if (existsSync(file)) {
      const { statSync } = await import('node:fs');
      if (statSync(file).size === expected) {
        skipped++;
        continue;
      }
      console.log(`chunk rusak terdeteksi, ambil ulang: ${chunk.name.slice(0, 12)}…`);
    }
    pending.push({ url: BASE + chunk.name, file });
  }
}

// Unduh paralel 6 koneksi — CDN imgly membatasi kecepatan per koneksi.
const POOL = 6;
let done = 0;
let cursor = 0;
const workers = Array.from({ length: POOL }, async () => {
  for (;;) {
    const item = pending[cursor++];
    if (!item) return;
    await download(item.url, item.file);
    done++;
    if (done % 5 === 0 || done === pending.length) {
      console.log(`chunk ${done}/${pending.length}`);
    }
  }
});
await Promise.all(workers);
console.log(`Selesai: total ${(total / 1048576).toFixed(0)} MB${skipped ? `, ${skipped} chunk dilewati (sudah ada)` : ''}.`);
console.log('Aset imgly siap di public/imgly/ — muat ulang halaman lalu pilih model imgly.');

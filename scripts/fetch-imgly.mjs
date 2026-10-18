// Unduh aset @imgly/background-removal (model ISNet fp32/fp16/quint8 + runtime
// ONNX, lisensi AGPL-3.0) dari CDN resmi imgly ke public/imgly/ agar self-host
// — CSP connect-src 'self' dan janji "tanpa pihak ketiga" tetap utuh.
//
//   npm run setup:imgly
//
// Folder public/imgly/ di-gitignored. Idempoten: chunk yang sudah ada (dan hash-nya cocok) dilewati.
//
// Integritas: manifest dipin ke MANIFEST_SHA256 dan nama tiap chunk adalah sha256 isinya, jadi setiap
// byte yang ditulis terverifikasi — termasuk runtime ONNX yang nanti di-import sebagai modul di origin
// aplikasi. CDN yang disusupi tidak bisa menyelipkan kode atau menulis di luar public/imgly/.
// Semua varian yang dipakai panel diunduh — quint8 ±42 MB, fp16 ±84 MB, dan
// fp32 /models/isnet ±168 MB ("Maksimal") — plus runtime ONNX ±33 MB. Ukuran
// itu nyata (dihitung dari resources.json), bukan perkiraan.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dest = join(root, 'public', 'imgly');
mkdirSync(dest, { recursive: true });

const VERSION = '1.7.0';
const BASE = `https://staticimgly.com/@imgly/background-removal-data/${VERSION}/dist/`;
// sha256 dari JSON.stringify(resources.json) versi di atas. Naik versi: jalankan skrip, tinjau
// manifest barunya, lalu salin hash yang dicetak pesan galat ke sini.
const MANIFEST_SHA256 = 'eb9e8f7ad081492f3b210b5e1791cebd32bcd3593d7907acde2046031f06c496';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Satu koneksi yang timeout (ETIMEDOUT dari CDN) dulu menghentikan seluruh unduhan dan menyisakan
// model setengah terpasang. Galat jaringan dicoba ulang dengan jeda bertahap; hash yang tidak cocok
// bukan galat jaringan, jadi langsung gagal. Berkas baru ditulis setelah hash-nya cocok dengan nama
// chunk, jadi tidak ada chunk setengah jadi atau palsu di disk.
async function download(url, file, hash, attempts = 4) {
  for (let i = 1; ; i++) {
    let bytes;
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status} untuk ${url}`);
      bytes = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (i >= attempts) throw err;
      console.log(`unduhan terputus (${err.cause?.code ?? err.message}), coba lagi ${i}/${attempts - 1}…`);
      await new Promise((resolve) => setTimeout(resolve, 2000 * i));
      continue;
    }
    if (sha256(bytes) !== hash) throw new Error(`hash chunk ${hash.slice(0, 12)}… tidak cocok — unduhan ditolak`);
    writeFileSync(file, bytes);
    return;
  }
}

const manifestUrl = BASE + 'resources.json';
const manifestFile = join(dest, 'resources.json');
console.log('mengunduh: resources.json');
const manifestRes = await fetch(manifestUrl);
if (!manifestRes.ok) throw new Error(`HTTP ${manifestRes.status} untuk ${manifestUrl}`);
const manifest = await manifestRes.json();
const manifestJson = JSON.stringify(manifest);
if (sha256(manifestJson) !== MANIFEST_SHA256) {
  throw new Error(`resources.json ${VERSION} tidak cocok dengan hash yang dipin (dapat ${sha256(manifestJson)}). Tinjau manifest-nya sebelum memperbarui MANIFEST_SHA256.`);
}
writeFileSync(manifestFile, manifestJson);

let total = 0;
let skipped = 0;
const pending = [];
for (const [key, entry] of Object.entries(manifest)) {
  console.log(`resource ${key}: ${(entry.size / 1048576).toFixed(1)} MB (${entry.chunks.length} chunk)`);
  total += entry.size;
  for (const chunk of entry.chunks) {
    // Nama chunk = sha256 isinya; selain itu (mis. '../') tidak pernah dipakai sebagai path.
    if (!/^[0-9a-f]{64}$/.test(chunk.name)) throw new Error(`nama chunk tidak sah: ${String(chunk.name).slice(0, 40)}`);
    const file = join(dest, chunk.name);
    // Lewati hanya bila utuh — unduhan lama (sebelum cek hash) bisa menyisakan chunk setengah jadi.
    if (existsSync(file)) {
      if (sha256(readFileSync(file)) === chunk.name) {
        skipped++;
        continue;
      }
      console.log(`chunk rusak terdeteksi, ambil ulang: ${chunk.name.slice(0, 12)}…`);
    }
    pending.push({ url: BASE + chunk.name, file, hash: chunk.name });
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
    await download(item.url, item.file, item.hash);
    done++;
    if (done % 5 === 0 || done === pending.length) {
      console.log(`chunk ${done}/${pending.length}`);
    }
  }
});
await Promise.all(workers);
console.log(`Selesai: total ${(total / 1048576).toFixed(0)} MB${skipped ? `, ${skipped} chunk dilewati (sudah ada)` : ''}.`);
console.log('Aset imgly siap di public/imgly/ — muat ulang halaman lalu pilih model imgly.');

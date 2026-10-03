#!/usr/bin/env node
/**
 * Penjaga hasil build: menolak `dist/` yang akan rusak di produksi.
 *
 * Kenapa ini perlu ada sebagai pemeriksaan terpisah:
 *
 * Di `npm run dev`, Vite menyajikan `.ts` sebagai `text/javascript` dan
 * men-transpile on the fly — semuanya tampak normal. Setelah `vite build`,
 * pola worker yang tidak dikenali Vite berubah jadi kerusakan nyata:
 *
 *   1. `new URL(...)` yang disimpan ke variabel dulu (bukan inline di dalam
 *      `new Worker(...)`) tidak dikenali Vite sebagai worker. Berkas `.ts`
 *      mentah ikut tersalin ke dist, dan nginx memetakan ekstensi `.ts` ke
 *      `video/mp2t` (lihat `ts` di /etc/nginx/mime.types). Worker ditolak →
 *      fitur mati HANYA di produksi.
 *
 *   2. Worker kecil (< 4 kB) di-inline jadi `data:` URL. CSP aplikasi
 *      (`worker-src 'self' blob:`) menolak `data:` → worker juga mati.
 *      Varian ini tidak mengandung string ".ts" sama sekali, jadi tidak
 *      tertangkap pemeriksaan berbasis pencarian teks — hanya ketahuan dari
 *      chunk worker yang hilang.
 *
 * Keduanya lolos `tsc` dan seluruh vitest, karena ini perilaku bundling,
 * bukan logika. Karena itu diperiksa di sini, dari hasil build sungguhan.
 *
 * Pakai:
 *   node scripts/check-dist.mjs          # periksa ./dist
 *   node scripts/check-dist.mjs dist-bug # periksa direktori lain
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const dir = process.argv[2] || 'dist';
const EKSTEN_TS = new Set(['.ts', '.tsx', '.mts', '.cts']);

// Worker yang WAJIB muncul sebagai chunk ter-hash. Kalau salah satu hilang,
// berarti Vite tidak mengenalinya sebagai worker (di-inline atau disalin mentah).
const WORKER_WAJIB = [
  { pola: /^bg-removal\.worker-[\w-]+\.js$/, contoh: 'bg-removal.worker-AbCd1234.js', nama: 'Hapus Latar — jalur Cepat (u2netp)' },
  { pola: /^imgly\.worker-[\w-]+\.js$/, contoh: 'imgly.worker-AbCd1234.js', nama: 'Hapus Latar — jalur imgly' },
  { pola: /^worker-[\w-]+\.js$/, contoh: 'worker-AbCd1234.js', nama: 'worker mesin PDF (pdf-lib)' },
  { pola: /^pdf\.worker\.min-[\w-]+\.mjs$/, contoh: 'pdf.worker.min-AbCd1234.mjs', nama: 'worker pdf.js' },
];

// Rujukan ke berkas .ts yang menunjuk ke direktori aset hasil build.
// Sengaja disempitkan ke `/assets/`: itulah bentuk nyata berkas bocor
// (`./assets/bg-removal.worker-DiXqAskA.ts`). Pola yang lebih longgar
// menangkap positif palsu — mis. `./src/index.ts` milik bundel library,
// `index.d.ts`, atau sekadar penyebutan `main.tsx` di komentar `sw.js`.
const R_RUJUKAN_TS = /(?:\.?\/)?assets\/[\w.-]+\.tsx?/g;
// `new Worker(` yang diberi URL data: — ditolak CSP `worker-src 'self' blob:`.

const TERIKSA_TEKS = new Set(['.js', '.mjs', '.cjs', '.css', '.html']);

function* berkas(direktori) {
  for (const isi of readdirSync(direktori, { withFileTypes: true })) {
    const jalur = join(direktori, isi.name);
    if (isi.isDirectory()) yield* berkas(jalur);
    else if (isi.isFile()) yield jalur;
  }
}

function ekstensi(jalur) {
  const nama = basename(jalur);
  const titik = nama.lastIndexOf('.');
  return titik === -1 ? '' : nama.slice(titik).toLowerCase();
}

if (!existsSync(dir)) {
  console.error(`✗ Direktori "${dir}" tidak ada — jalankan build dulu.`);
  process.exit(1);
}

const semua = [...berkas(dir)];
const masalah = [];

// 1. Berkas TypeScript mentah ikut tersalin.
// `.d.ts` dikecualikan: deklarasi tipe tidak pernah di-request, jadi tidak
// merusak fitur — dan beberapa paket memang menitipkannya.
const tsMentah = semua.filter(
  (f) => EKSTEN_TS.has(ekstensi(f)) && !/\.d\.(ts|mts|cts)$/i.test(basename(f)),
);
if (tsMentah.length) {
  masalah.push({
    judul: 'Berkas TypeScript mentah ikut ke dist',
    rincian: tsMentah.map((f) => `  ${f}`),
    saran: 'nginx menyajikan `.ts` sebagai `video/mp2t`, jadi berkas ini mati di produksi. Pakai pola inline: new Worker(new URL(\'./x.worker.ts\', import.meta.url), { type: \'module\' }).',
  });
}

// 2. Ada aset yang merujuk ke berkas .ts.
const rujukan = [];
for (const f of semua.filter((f) => TERIKSA_TEKS.has(ekstensi(f)))) {
  const teks = readFileSync(f, 'utf8');
  for (const m of teks.matchAll(R_RUJUKAN_TS)) rujukan.push(`  ${f} → ${m[0]}`);
}
if (rujukan.length) {
  masalah.push({
    judul: 'Aset hasil build merujuk ke berkas .ts',
    rincian: [...new Set(rujukan)],
    saran: 'Rujukan ini akan 404/`video/mp2t` di produksi. Sama seperti di atas: pastikan `new URL(...)` inline di dalam `new Worker(...)`.',
  });
}

// 3. Worker dibangun dari `data:` URL — ditolak CSP `worker-src 'self' blob:`.
// Vite meng-inline worker kecil (< 4 kB) jadi data URL, lalu hasil minifikasi
// menyalinnya ke variabel (`new Worker(tH, …)`), sehingga pencarian literal
// `new Worker("data:…")` TIDAK cukup — sudah dibuktikan pada build rusak
// (worker imgly). Karena itu nama variabelnya diselesaikan dulu.
// Aman dari positif palsu: `data:` gambar/font milik aplikasi tidak pernah
// dilewatkan ke `new Worker(...)`.
const R_DATA_VAR = /([\w$]+)\s*=(?!=)\s*(?:new\s+URL\(\s*)?["'`]data:([^"'`]{0,60})/g;
const R_WORKER_ARG = /new\s+Worker\(\s*([\w$]+)\s*[,)]/g;
const R_WORKER_LITERAL = /new\s+Worker\(\s*(?:new\s+URL\(\s*)?["'`](data:[^"'`]{0,60})/g;

const workerData = [];
for (const f of semua.filter((f) => TERIKSA_TEKS.has(ekstensi(f)))) {
  const teks = readFileSync(f, 'utf8');
  const variabelData = new Map([...teks.matchAll(R_DATA_VAR)].map((m) => [m[1], m[2]]));
  for (const m of teks.matchAll(R_WORKER_LITERAL)) {
    workerData.push(`  ${f} → new Worker("${m[1].slice(0, 60)}…")`);
  }
  for (const m of teks.matchAll(R_WORKER_ARG)) {
    const isi = variabelData.get(m[1]);
    if (isi) workerData.push(`  ${f} → new Worker(${m[1]}) — ${m[1]} = "data:${isi}…"`);
  }
}
if (workerData.length) {
  masalah.push({
    judul: 'Worker dibuat dari `data:` URL',
    rincian: [...new Set(workerData)],
    saran: "CSP aplikasi hanya mengizinkan `worker-src 'self' blob:`, jadi worker `data:` ditolak browser.",
  });
}

// 4. Worker yang seharusnya ada, tidak ada.
const namaBerkas = new Set(semua.map((f) => basename(f)));
const hilang = WORKER_WAJIB.filter((w) => ![...namaBerkas].some((n) => w.pola.test(n)));
if (hilang.length) {
  masalah.push({
    judul: 'Chunk worker tidak ditemukan di dist',
    rincian: hilang.map((w) => `  ${w.nama}\n      diharapkan ada berkas seperti ${w.contoh}`),
    saran: 'Worker kemungkinan di-inline Vite (data: URL) atau disalin mentah. Cek pola `new Worker(new URL(...))` pada berkas terkait.',
  });
}

if (masalah.length) {
  console.error(`\n✗ Hasil build TIDAK layak di-deploy — ${masalah.length} masalah di "${dir}":\n`);
  masalah.forEach((m, i) => {
    console.error(`${i + 1}. ${m.judul}`);
    m.rincian.forEach((r) => console.error(r));
    console.error(`   → ${m.saran}\n`);
  });
  process.exit(1);
}

console.log(
  `✓ Hasil build layak di-deploy — ${semua.length} berkas diperiksa, tidak ada .ts mentah, ` +
    `${WORKER_WAJIB.length} chunk worker lengkap.`,
);

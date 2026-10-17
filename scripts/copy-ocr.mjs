// Salin aset OCR tesseract.js dari node_modules ke public/tesseract/ agar self-host —
// tanpa ini tesseract.js mengunduh worker, core WASM, dan data bahasa dari CDN
// (melanggar CSP connect-src 'self' dan janji "tanpa pihak ketiga").
//
//   npm run setup:ocr
//
// Folder public/tesseract/ di-gitignored. Idempoten. Total ±16 MB: worker, tiga
// varian core LSTM (worker memilih satu sesuai dukungan SIMD browser, ±3,9 MB),
// dan data bahasa best_int Indonesia (±1,2 MB) + Inggris (±2,9 MB) ter-gzip.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dest = join(root, 'public', 'tesseract');
const require = createRequire(import.meta.url);
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));

const files = [
  [join(pkgDir('tesseract.js'), 'dist', 'worker.min.js'), join(dest, 'worker.min.js')],
  ...['tesseract-core-relaxedsimd-lstm', 'tesseract-core-simd-lstm', 'tesseract-core-lstm'].map((name) => [
    join(pkgDir('tesseract.js-core'), `${name}.wasm.js`), join(dest, 'core', `${name}.wasm.js`),
  ]),
  ...['ind', 'eng'].map((lang) => [
    join(pkgDir(`@tesseract.js-data/${lang}`), '4.0.0_best_int', `${lang}.traineddata.gz`), join(dest, 'lang', `${lang}.traineddata.gz`),
  ]),
];

for (const [from, to] of files) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`disalin: ${to.slice(root.length + 1)}`);
}
console.log('Aset OCR siap di public/tesseract/ — muat ulang halaman.');

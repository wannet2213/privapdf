#!/usr/bin/env node
// Penyaji statis untuk dist/ di satu port — tanpa nginx, tanpa Caddy, tanpa dependensi.
// Setara perilaku privapdf.conf: header keamanan + COOP/COEP (tanpanya Office WASM
// tidak mendapat SharedArrayBuffer dan mati), SPA fallback try_files → index.html,
// dan .gz prakompresi hasil `npm run setup:office` disajikan langsung sebagai
// Content-Encoding: gzip (kompresi on-the-fly untuk WASM 141 MB tidak realistis).
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.env.DIST ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'));
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

const cacheControl = (pathname) => {
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (pathname === '/' || pathname === '/index.html' || pathname === '/sw.js') return 'no-cache';
  // /wasm/, /models/, /imgly/, /tesseract/ hanya berubah lewat setup:* baru — bukan tiap
  // deploy. 7 hari + service worker cache-first menjaga kunjungan ulang tetap
  // tanpa unduh ulang 237 MB.
  if (/^\/(wasm|models|imgly|tesseract)\//.test(pathname)) {
    return 'public, max-age=604800';
  }
  return 'public, max-age=3600';
};

const statFile = (path) => {
  try {
    const stat = statSync(path);
    return stat.isFile() ? stat : undefined;
  } catch {
    return undefined;
  }
};

createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, SECURITY_HEADERS).end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400, SECURITY_HEADERS).end('URL tidak valid.');
    return;
  }

  const target = resolve(ROOT, `.${pathname}`);
  if (target !== ROOT && !target.startsWith(ROOT + sep)) {
    res.writeHead(403, SECURITY_HEADERS).end();
    return;
  }

  let file = target;
  let fileStat = statFile(file);
  if (!fileStat) {
    const dirIndex = join(target, 'index.html');
    fileStat = statFile(dirIndex);
    if (fileStat) file = dirIndex;
  }
  if (!fileStat) {
    // Aset yang hilang (chunk lama setelah deploy, WASM belum di-setup) harus 404 —
    // bila dijawab index.html, HTML itu ikut tercache dengan aturan aset (immutable).
    if (extname(pathname) || /^\/(assets|wasm|models|imgly|tesseract)\//.test(pathname)) {
      res.writeHead(404, { ...SECURITY_HEADERS, 'Cache-Control': 'no-cache' }).end();
      return;
    }
    // Rute SPA (mis. /gabung) tidak ada di disk — setara try_files ... /index.html.
    file = join(ROOT, 'index.html');
    fileStat = statFile(file);
    if (!fileStat) {
      res.writeHead(404, SECURITY_HEADERS).end('dist/ belum ada — jalankan npm run build.');
      return;
    }
  }

  const headers = {
    ...SECURITY_HEADERS,
    'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': file === join(ROOT, 'index.html') ? 'no-cache' : cacheControl(pathname),
  };

  // Prakompresi: .br (brotli) diutamakan, .gz sebagai fallback. Keduanya
  // disiapkan `npm run setup:office` SETELAH patch browser.worker.js.
  const enc = String(req.headers['accept-encoding'] ?? '');
  const brFile = `${file}.br`;
  const gzFile = `${file}.gz`;
  let source = file;
  if (/\bbr\b/i.test(enc) && statFile(brFile)) {
    source = brFile;
    headers['Content-Encoding'] = 'br';
  } else if (/\bgzip\b/i.test(enc) && statFile(gzFile)) {
    source = gzFile;
    headers['Content-Encoding'] = 'gzip';
  }
  if (statFile(brFile) || statFile(gzFile)) headers['Vary'] = 'Accept-Encoding';
  headers['Content-Length'] = String(statSync(source).size);

  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(source);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}).listen(PORT, HOST, () => {
  console.log(`privapdf tersaji di http://${HOST}:${PORT} — ${ROOT}`);
});

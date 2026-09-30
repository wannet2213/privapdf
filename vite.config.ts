import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

// Dev-only: sajikan runtime ESM ort-wasm dari public/ secara mentah. Tanpa ini,
// dynamic import ORT terkena ?import dan ditolak Vite ("file in /public ...").
// Production tidak terpengaruh (public tersalin apa adanya saat build).
function serveModelRuntime() {
  return {
    name: 'serve-model-runtime-raw',
    configureServer(server: { middlewares: { use: (fn: (req: any, res: any, next: () => void) => void) => void } }) {
      server.middlewares.use((req: { url?: string }, res: { setHeader: (k: string, v: string) => void; writeHead: (code: number) => void }, next: () => void) => {
        const url = (req.url || '').split('?')[0];
        if (!url.startsWith('/models/bg/') || !url.endsWith('.mjs')) return next();
        const file = join(rootDir, 'public', url);
        if (!existsSync(file)) return next();
        res.setHeader('content-type', 'text/javascript');
        createReadStream(file).pipe(res as never);
      });
    },
  };
}

// COOP/COEP headers are required so the page is "crossOriginIsolated",
// which enables SharedArrayBuffer (used by the LibreOffice WASM worker).
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export default defineConfig({
  plugins: [react(), serveModelRuntime()],
  server: {
    headers: crossOriginIsolationHeaders,
    // Host tunnel/proxy publik untuk dev (Vite memblokir Host tak dikenal
    // untuk mencegah DNS rebinding — jangan ganti dengan allowedHosts: true).
    allowedHosts: ['test.irwannet.my.id'],
  },
  preview: {
    headers: crossOriginIsolationHeaders,
    allowedHosts: ['test.irwannet.my.id'],
  },
  worker: { format: 'es' },
  // onnxruntime-web memuat runtime .mjs-nya sendiri dari /models/bg/ (public/)
  // lewat dynamic import — jangan di-prebundle, otherwise Vite menambahkan
  // ?import dan menolak file public.
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  test: { environment: 'jsdom', globals: true },
});

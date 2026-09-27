import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// COOP/COEP headers are required so the page is "crossOriginIsolated",
// which enables SharedArrayBuffer (used by the LibreOffice WASM worker).
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export default defineConfig({
  plugins: [react()],
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
  test: { environment: 'jsdom', globals: true },
});

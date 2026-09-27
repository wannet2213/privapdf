import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

describe('PWA assets', () => {
  it('ships a manifest and service worker without document caching', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'public/manifest.webmanifest'), 'utf8')) as {
      display?: string;
      start_url?: string;
    };
    const serviceWorker = readFileSync(resolve(root, 'public/sw.js'), 'utf8');

    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(serviceWorker).not.toMatch(/cache.*document|indexeddb/i);
  });

  it('precaches only files that exist and never caches HTML as an asset', () => {
    const serviceWorker = readFileSync(resolve(root, 'public/sw.js'), 'utf8');

    // SPA rewrite menjawab 200 (index.html) untuk path yang tidak ada;
    // SHELL tidak boleh memuat path phantom (dulu: /wasm/office/*) dan
    // fetch handler harus menolak meng-cache content-type text/html.
    const shell = serviceWorker.match(/const SHELL = \[([^\]]*)\]/);
    expect(shell).toBeTruthy();
    for (const raw of shell![1].split(',')) {
      const path = raw.trim().replace(/['"]/g, '');
      if (!path || path === '/') continue;
      // Aset statis ada di public/, sedangkan /index.html berasal dari root proyek (template Vite).
      const rel = path.replace(/^\//, '');
      const found = existsSync(resolve(root, 'public', rel)) || existsSync(resolve(root, rel));
      expect(found, `SHELL entry missing: ${path}`).toBe(true);
    }
    expect(serviceWorker).not.toContain('/wasm/office/');
    expect(serviceWorker).toContain('text/html');
  });
});

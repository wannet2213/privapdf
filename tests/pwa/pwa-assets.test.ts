import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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
    expect(serviceWorker).toContain('/wasm/office/soffice.wasm');
  });
});

// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import config from '../../vite.config';

const repo = resolve(__dirname, '../..');

/** Jalankan salinan setup:imgly di folder sementara dengan fetch tiruan (tanpa jaringan). */
function runFetchImgly(manifest: string, chunkBody: string) {
  const root = mkdtempSync(join(tmpdir(), 'imgly-'));
  mkdirSync(join(root, 'scripts'));
  cpSync(join(repo, 'scripts/fetch-imgly.mjs'), join(root, 'scripts/fetch-imgly.mjs'));
  const mock = join(root, 'mock-fetch.mjs');
  writeFileSync(mock, `const manifest = ${JSON.stringify(manifest)};
globalThis.fetch = async (url) => new Response(String(url).endsWith('resources.json') ? manifest : ${JSON.stringify(chunkBody)});`);
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(mock).href, join(root, 'scripts/fetch-imgly.mjs')], { encoding: 'utf8', timeout: 60_000 });
  const written = existsSync(join(root, 'public/imgly')) ? readdirSync(join(root, 'public/imgly')) : [];
  const escaped = existsSync(join(root, 'PWNED.txt')) || existsSync(join(root, 'scripts/PWNED.txt'));
  rmSync(root, { recursive: true, force: true });
  return { status: r.status, stderr: r.stderr, written, escaped };
}

describe('setup:imgly', () => {
  it('menolak manifest yang tidak cocok dengan hash yang dipin — tidak ada yang ditulis', () => {
    const evil = JSON.stringify({ x: { size: 4, chunks: [{ name: '../../PWNED.txt', offsets: [0, 4] }] } });
    const r = runFetchImgly(evil, 'PWND');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('tidak cocok dengan hash yang dipin');
    expect(r.escaped).toBe(false);
    expect(r.written).toEqual([]);
  });

  // Manifest asli hanya ada setelah `npm run setup:imgly` (public/imgly di-gitignore).
  const realManifest = join(repo, 'public/imgly/resources.json');
  it.skipIf(!existsSync(realManifest))('menolak chunk yang isinya tidak sesuai hash namanya', () => {
    const r = runFetchImgly(readFileSync(realManifest, 'utf8'), 'bukan isi chunk asli');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('tidak cocok');
    expect(r.written).toEqual(['resources.json']);
  });
});

describe('dev server: runtime ORT mentah', () => {
  type Handler = (req: { url?: string }, res: { setHeader: () => void; writeHead: () => void }, next: () => void) => void;
  let handler: Handler | undefined;
  const plugin = (config.plugins as { name?: string; configureServer?: (s: unknown) => void }[]).find((p) => p?.name === 'serve-model-runtime-raw');
  plugin!.configureServer!({ middlewares: { use: (fn: Handler) => { handler = fn; } } });

  it('tidak melayani .mjs di luar public/models/bg lewat ../', () => {
    const next = vi.fn();
    const res = { setHeader: vi.fn(), writeHead: vi.fn() };
    // scripts/fetch-imgly.mjs ada di repo: dulu tersaji lewat URL mentah ini.
    handler!({ url: '/models/bg/../../../scripts/fetch-imgly.mjs' }, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
  });
});

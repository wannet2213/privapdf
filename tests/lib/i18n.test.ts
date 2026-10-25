import { afterEach, describe, expect, it, vi } from 'vitest';

const load = async (language: string) => {
  Object.defineProperty(navigator, 'language', { value: language, configurable: true });
  vi.resetModules();
  return import('../../src/lib/i18n');
};

describe('i18n', () => {
  afterEach(() => { Object.defineProperty(navigator, 'language', { value: 'id-ID', configurable: true }); });

  it('perangkat berbahasa Indonesia memakai id', async () => {
    for (const l of ['id', 'id-ID', 'in-ID']) {
      const { lang, tr } = await load(l);
      expect(lang).toBe('id');
      expect(tr('Halo', 'Hello')).toBe('Halo');
    }
  });

  it('bahasa lain memakai en', async () => {
    for (const l of ['en-US', 'ms-MY', 'ja', 'ind', '']) {
      const { lang, tr } = await load(l);
      expect(lang).toBe('en');
      expect(tr('Halo', 'Hello')).toBe('Hello');
    }
  });
});

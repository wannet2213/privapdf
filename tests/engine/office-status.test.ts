import { describe, expect, it } from 'vitest';
import { officeStatus } from '../../src/engines/office-native';

describe('office status', () => {
  it('menerjemahkan fase unduhan menjadi kalimat aktivitas dengan ukuran byte', () => {
    expect(officeStatus({ phase: 'download-wasm', percent: 12, message: 'Downloading WebAssembly...', bytesLoaded: 12e6, bytesTotal: 141e6 }))
      .toMatch(/Mengunduh mesin konversi \(WASM\)… 11\.4 \/ 134\.5 MB/);
  });

  it('menerjemahkan fase non-unduhan menjadi kalimat dengan persen', () => {
    expect(officeStatus({ phase: 'lok-init', percent: 57, message: 'Initializing LibreOfficeKit...' }))
      .toMatch(/Menyiapkan LibreOffice… 57%/);
    expect(officeStatus({ phase: 'converting', percent: 60, message: 'Converting format...' }))
      .toMatch(/Mengonversi dokumen… 60%/);
  });

  it('memakai pesan pustaka apa adanya untuk fase yang tidak dikenal', () => {
    expect(officeStatus({ phase: 'starting', percent: 0, message: 'Starting...' })).toBe('Starting...');
  });
});

import { WorkerBrowserConverter, createWasmPaths } from '@matbee/libreoffice-converter/browser';

type Progress = (percent: number, message: string) => void;
let converterPromise: Promise<WorkerBrowserConverter> | undefined;
// Handler progres disimpan di modul, bukan ditangkap sekali saat pembuatan:
// pramuat() membuat konverter tanpa handler, dan convert() sesudahnya harus
// tetap bisa melaporkan progres.
let progressHandler: Progress | undefined;

function getConverter(onProgress?: Progress) {
  if (onProgress) progressHandler = onProgress;
  if (!converterPromise) {
    converterPromise = Promise.resolve(new WorkerBrowserConverter({
      ...createWasmPaths('/wasm/office/'),
      browserWorkerJs: '/wasm/office/browser.worker.js',
      onProgress: (info) => progressHandler?.(info.percent, info.message),
    })).then(async (instance) => {
      await instance.initialize();
      return instance;
    }).catch((error) => {
      converterPromise = undefined;
      throw error;
    });
  }
  return converterPromise;
}

/**
 * Mulai memuat aset WASM (~237 MB) sebelum pengguna menekan tombol konversi.
 * Unduhan lewat tunnel makan ~2 menit; memulainya saat file dipilih berarti
 * waktu itu terpakai sambil pengguna meninjau berkas. Kegagalan diabaikan —
 * pramuat tidak boleh memunculkan galat sebelum ada aksi pengguna; percobaan
 * sungguhan terjadi lagi di officeToPdf().
 */
export function preloadOfficeConverter() {
  if (converterPromise) return;
  void getConverter().catch(() => undefined);
}

export async function officeToPdf(input: ArrayBuffer, filename: string, onProgress?: Progress) {
  const converter = await getConverter(onProgress);
  const result = await converter.convert(input, { outputFormat: 'pdf' }, filename);
  return { data: result.data.buffer.slice(result.data.byteOffset, result.data.byteOffset + result.data.byteLength), filename: result.filename, mimeType: result.mimeType };
}

export async function destroyOfficeConverter() {
  if (converterPromise) {
    const converter = await converterPromise.catch(() => undefined);
    await converter?.destroy();
    converterPromise = undefined;
  }
}

export function officeCapability() { const isolated = typeof crossOriginIsolated === 'boolean' && crossOriginIsolated; const wasm = typeof WebAssembly !== 'undefined'; const worker = typeof Worker !== 'undefined'; return { available: isolated && wasm && worker, reason: isolated && wasm && worker ? 'Runtime Office WASM siap dimuat.' : 'Memerlukan COOP/COEP, WebAssembly, dan Worker.' }; }

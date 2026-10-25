import { WorkerBrowserConverter, createWasmPaths } from '@matbee/libreoffice-converter/browser';
import { tr } from '../lib/i18n';

type LoadProgress = { phase: string; percent: number; message: string; bytesLoaded?: number; bytesTotal?: number };
type Progress = (percent: number, status: string) => void;
let converterPromise: Promise<WorkerBrowserConverter> | undefined;
// Handler progres disimpan di modul, bukan ditangkap sekali saat pembuatan:
// pramuat() membuat konverter tanpa handler, dan convert() sesudahnya harus
// tetap bisa melaporkan progres.
let progressHandler: Progress | undefined;

const PHASE_LABEL: Record<string, string> = {
  'download-wasm': tr('Mengunduh mesin konversi (WASM)', 'Downloading the conversion engine (WASM)'),
  'download-data': tr('Mengunduh data sistem berkas', 'Downloading file system data'),
  compile: tr('Mengompilasi mesin WASM', 'Compiling the WASM engine'),
  filesystem: tr('Menyiapkan sistem berkas virtual', 'Preparing the virtual file system'),
  'lok-init': tr('Menyiapkan LibreOffice', 'Preparing LibreOffice'),
  loading: tr('Memuat mesin WASM', 'Loading the WASM engine'),
  initializing: tr('Inisialisasi', 'Initializing'),
  converting: tr('Mengonversi dokumen', 'Converting the document'),
  complete: tr('Menyelesaikan', 'Finishing'),
};

/** Fase pustaka → kalimat aktivitas yang ditampilkan pengguna. */
export function officeStatus(info: LoadProgress): string {
  const label = PHASE_LABEL[info.phase];
  if (!label) return info.message;
  if ((info.phase === 'download-wasm' || info.phase === 'download-data') && info.bytesTotal) {
    const mb = (n: number) => (n / 1048576).toFixed(1);
    return `${label}… ${mb(info.bytesLoaded ?? 0)} / ${mb(info.bytesTotal)} MB`;
  }
  return `${label}… ${Math.round(info.percent)}%`;
}

function getConverter(onProgress?: Progress) {
  if (onProgress) progressHandler = onProgress;
  if (!converterPromise) {
    converterPromise = Promise.resolve(new WorkerBrowserConverter({
      ...createWasmPaths('/wasm/office/'),
      browserWorkerJs: '/wasm/office/browser.worker.js',
      onProgress: (info) => progressHandler?.(info.percent, officeStatus(info)),
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
  // Jangan mulai mengunduh 237 MB di konteks yang pasti gagal — officeToPdf
  // nanti menolak dengan pesan yang jelas (lihat officeToPdf).
  if (typeof crossOriginIsolated !== 'boolean' || !crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') return;
  void getConverter().catch(() => undefined);
}

export async function officeToPdf(input: ArrayBuffer, filename: string, onProgress?: Progress) {
  // Tanpa SharedArrayBuffer, pthread_create LibreOffice WASM gagal diam-diam
  // dan inisialisasi menggantung tanpa pesan (pernah tampak "macet di 55%").
  // Konteks tanpa isolasi: webview/pratinjau tersemat, atau situs tanpa COOP/COEP.
  if (typeof crossOriginIsolated !== 'boolean' || !crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
    throw new Error(tr('Browser ini tidak mengizinkan SharedArrayBuffer (crossOriginIsolated=false) — dibutuhkan LibreOffice WASM. Buka lewat browser biasa via HTTPS atau localhost, bukan webview/pratinjau tersemat.', 'This browser does not allow SharedArrayBuffer (crossOriginIsolated=false), which LibreOffice WASM needs. Open it in a regular browser over HTTPS or localhost, not an embedded webview/preview.'));
  }
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

export function officeCapability() { const isolated = typeof crossOriginIsolated === 'boolean' && crossOriginIsolated; const wasm = typeof WebAssembly !== 'undefined'; const worker = typeof Worker !== 'undefined'; return { available: isolated && wasm && worker, reason: isolated && wasm && worker ? tr('Runtime Office WASM siap dimuat.', 'Office WASM runtime is ready to load.') : tr('Memerlukan COOP/COEP, WebAssembly, dan Worker.', 'Requires COOP/COEP, WebAssembly, and Worker.') }; }

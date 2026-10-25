/**
 * Klien tool "Hapus latar" via @imgly/background-removal (AGPL-3.0).
 * Berjalan di dedicated worker (lihat workers/imgly.worker.ts) — CSP dokumen
 * tetap ketat. Aset model self-host di /imgly/ lewat `npm run setup:imgly`.
 */

import { tr } from './i18n';

const TIMEOUT_MS = 10 * 60_000;

export type ImglyModel = 'isnet' | 'isnet_fp16' | 'isnet_quint8';

const MODEL_LABEL: Record<ImglyModel, string> = { isnet: tr('Maksimal', 'Maximum'), isnet_fp16: tr('Seimbang', 'Balanced'), isnet_quint8: tr('Ringan', 'Light') };

// imgly tidak memeriksa status HTTP potongan model: aset yang belum terpasang muncul sebagai ukuran
// tak cocok (server menjawab halaman HTML/404, mis. "with size 4194304 but got 948") atau "not found".
const MISSING_ASSET = /Failed to fetch .* with size|Resource( metadata)? .*not found/;

/** Pesan galat imgly → kalimat yang bisa ditindaklanjuti pengguna. */
export function imglyErrorMessage(error: string, model: ImglyModel): string {
  return MISSING_ASSET.test(error)
    ? tr(`Model "${MODEL_LABEL[model]}" belum terpasang lengkap di server ini (npm run setup:imgly). Pilih kualitas model lain atau pasang asetnya.`, `The "${MODEL_LABEL[model]}" model is not fully installed on this server (npm run setup:imgly). Pick another model quality or install its assets.`)
    : error;
}

/** Hapus latar dengan imgly ISNet. Buffer input tidak diubah (disalin internal). */
export async function removeBackgroundImgly(
  input: ArrayBuffer,
  model: ImglyModel,
  onStatus?: (message: string) => void,
): Promise<Blob> {
  const copy = input.slice(0);
  return new Promise<Blob>((resolve, reject) => {
    // new URL() wajib inline di dalam new Worker() — lihat catatan di remove-bg-ai.ts.
    const worker = new Worker(new URL('../workers/imgly.worker.ts', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error(tr('Pemrosesan melebihi 10 menit — dibatalkan. Coba varian lebih ringan.', 'Processing took over 10 minutes — cancelled. Try a lighter variant.')));
    }, TIMEOUT_MS);
    const fail = (message: string) => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error(message));
    };
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; message?: string; error?: string; blob?: Blob };
      if (m.type === 'status') onStatus?.(m.message || tr('Memproses…', 'Processing…'));
      else if (m.type === 'result' && m.blob) {
        clearTimeout(timer);
        worker.terminate();
        resolve(m.blob);
      } else if (m.type === 'error') {
        fail(imglyErrorMessage(m.error || tr('Konversi gagal.', 'Conversion failed.'), model));
      }
    };
    worker.onerror = () => fail(tr('Komponen AI gagal dimuat. Fitur ini mungkin belum aktif di situs ini.', 'The AI component failed to load. This feature may not be enabled on this site.'));
    worker.postMessage({ type: 'convert', data: copy, model }, [copy]);
  });
}

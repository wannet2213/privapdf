/**
 * Klien tool "Hapus latar" via @imgly/background-removal (AGPL-3.0).
 * Berjalan di dedicated worker (lihat workers/imgly.worker.ts) — CSP dokumen
 * tetap ketat. Aset model self-host di /imgly/ lewat `npm run setup:imgly`.
 */

const TIMEOUT_MS = 10 * 60_000;

export type ImglyModel = 'isnet' | 'isnet_fp16' | 'isnet_quint8';

const MODEL_LABEL: Record<ImglyModel, string> = { isnet: 'Maksimal', isnet_fp16: 'Seimbang', isnet_quint8: 'Ringan' };

// imgly tidak memeriksa status HTTP potongan model: aset yang belum terpasang muncul sebagai ukuran
// tak cocok (server menjawab halaman HTML/404, mis. "with size 4194304 but got 948") atau "not found".
const MISSING_ASSET = /Failed to fetch .* with size|Resource( metadata)? .*not found/;

/** Pesan galat imgly → kalimat yang bisa ditindaklanjuti pengguna. */
export function imglyErrorMessage(error: string, model: ImglyModel): string {
  return MISSING_ASSET.test(error)
    ? `Model "${MODEL_LABEL[model]}" belum terpasang lengkap di server ini (npm run setup:imgly). Pilih kualitas model lain atau pasang asetnya.`
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
      reject(new Error('Pemrosesan melebihi 10 menit — dibatalkan. Coba varian lebih ringan.'));
    }, TIMEOUT_MS);
    const fail = (message: string) => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error(message));
    };
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; message?: string; error?: string; blob?: Blob };
      if (m.type === 'status') onStatus?.(m.message || 'Memproses…');
      else if (m.type === 'result' && m.blob) {
        clearTimeout(timer);
        worker.terminate();
        resolve(m.blob);
      } else if (m.type === 'error') {
        fail(imglyErrorMessage(m.error || 'Konversi gagal.', model));
      }
    };
    worker.onerror = () => fail('Komponen AI gagal dimuat. Fitur ini mungkin belum aktif di situs ini.');
    worker.postMessage({ type: 'convert', data: copy, model }, [copy]);
  });
}

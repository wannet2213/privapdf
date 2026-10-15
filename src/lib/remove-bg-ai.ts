/**
 * Klien tool "Hapus latar" mode ORT bawaan: u2netp (±4 MB, Apache-2.0)
 * di dedicated worker. Untuk kualitas lebih baik gunakan jalur imgly
 * (remove-bg-imgly.ts).
 */

const TIMEOUT_MS = 10 * 60_000;

export type BgModelQuality = 'cepat' | 'imgly-fp16' | 'imgly-quint8' | 'imgly-fp32';

/** Hapus latar dengan u2netp. Buffer input tidak diubah (disalin internal). */
export async function removeBackgroundAI(
  input: ArrayBuffer,
  onStatus?: (message: string) => void,
): Promise<Blob> {
  const copy = input.slice(0);
  return new Promise<Blob>((resolve, reject) => {
    // new URL() wajib inline di dalam new Worker(): kalau disimpan ke variabel
    // dulu, Vite memperlakukannya sebagai aset statis — .ts mentah ikut tersalin
    // ke dist dan worker gagal dimuat di build produksi.
    const worker = new Worker(new URL('../workers/bg-removal.worker.ts', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('Pemrosesan melebihi 10 menit — dibatalkan.'));
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
        fail(m.error || 'Konversi gagal.');
      }
    };
    worker.onerror = () => fail('Komponen AI gagal dimuat. Fitur ini mungkin belum aktif di situs ini.');
    worker.postMessage({ type: 'convert', data: copy, model: 'u2netp.onnx' }, [copy]);
  });
}

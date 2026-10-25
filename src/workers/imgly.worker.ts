/**
 * Worker hapus latar via @imgly/background-removal (AGPL-3.0).
 * Dijalankan di dedicated worker: runtime ORT blob + kompilasi WASM + codegen
 * ndarray berjalan di sini, sehingga CSP dokumen tetap ketat tanpa
 * 'unsafe-eval' / blob: di script-src.
 */
import { removeBackground } from '@imgly/background-removal';
import * as ort from 'onnxruntime-web';
import { tr } from '../lib/i18n';

// imgly menyetel numThreads dari crossOriginIsolated (>1 di situs dengan
// COOP/COEP) — jalur pthread ORT di nested worker bisa deadlock saat sesi
// dibuat. Paksa 1 thread; fp16 1024² tetap selesai dalam hitungan detik.
ort.env.wasm.numThreads = 1;

function post(msg: unknown) {
  self.postMessage(msg);
}

function sniffMime(bytes: ArrayBuffer): string {
  const b = new Uint8Array(bytes, 0, 12);
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  return 'image/png';
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { type?: string; data?: ArrayBuffer; model?: string } | undefined;
  if (!msg || msg.type !== 'convert' || !msg.data) return;
  // Daftar putih varian: nilai tak dikenal jatuh ke fp16, bukan ke model yang
  // belum tentu ada di public/imgly/ (aset fp32 ±168 MB hanya diunduh
  // `npm run setup:imgly` sejak varian "Maksimal" ditambahkan).
  const model = msg.model === 'isnet' || msg.model === 'isnet_quint8' ? msg.model : 'isnet_fp16';
  try {
    const blob = await removeBackground(new Blob([msg.data], { type: sniffMime(msg.data) }), {
      publicPath: new URL('/imgly/', self.location.href).toString(),
      model,
      device: 'cpu',
      output: { format: 'image/png', quality: 1 },
      progress: (key: string, current: number, total: number) => {
        if (key.startsWith('fetch:')) {
          const name = key.slice(6).split('/').pop() || 'model';
          const pct = total > 0 ? Math.round((current / total) * 100) : 0;
          post({ type: 'status', message: `${tr('Mengunduh', 'Downloading')} ${name}… ${pct}%` });
        } else if (key.startsWith('compute:')) {
          post({ type: 'status', message: tr('Menghitung segmentasi dengan model imgly…', 'Computing segmentation with the imgly model…') });
        }
      },
    });
    post({ type: 'result', blob });
  } catch (err) {
    post({ type: 'error', error: String((err as Error)?.message ?? err) });
  }
};

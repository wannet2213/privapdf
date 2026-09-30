/**
 * Worker hapus latar AI opsi "Cepat": onnxruntime-web (WASM) + u2netp
 * (±4 MB, Apache-2.0 via rembg). Model dari /models/bg/ (self-hosted,
 * Cache API agar unduhan hanya sekali), inferensi di sini sehingga CSP
 * dokumen tak tersentuh. Kualitas lebih tinggi: jalur imgly.
 */
import * as ort from 'onnxruntime-web';
import { minMaxNormalize, U2NETP_INPUT_SIZE } from '../lib/bg-removal-core';

ort.env.wasm.wasmPaths = '/models/bg/';
// Paksa 1 thread: jalur pthread ORT (numThreads > 1) di dalam nested worker
// terkenal bisa deadlock saat sesi dibuat — dan u2netp 320² tidak butuhnya.
ort.env.wasm.numThreads = 1;

const CACHE_NAME = 'removebg-model';
const MODEL_FILE = 'u2netp.onnx';
const sessions = new Map<string, ort.InferenceSession>();

function post(msg: unknown) {
  self.postMessage(msg);
}

async function fetchModelWithProgress(onStatus: (m: string) => void): Promise<Uint8Array> {
  const url = `/models/bg/${MODEL_FILE}`;
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(url);
  if (cached) {
    onStatus('Memuat model dari cache…');
    return new Uint8Array(await cached.arrayBuffer());
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Model tidak ditemukan (HTTP ${res.status}).`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body?.getReader();
  if (!reader) throw new Error('Respons model tidak dapat dibaca.');
  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastPct = -1;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total > 0) {
      const pct = Math.floor((received / total) * 100);
      if (pct !== lastPct && pct % 10 === 0) {
        lastPct = pct;
        onStatus(`Mengunduh model u2netp (${(total / 1048576).toFixed(0)} MB)… ${pct}%`);
      }
    }
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  await cache.put(url, new Response(bytes.slice(), { headers: { 'content-type': 'application/octet-stream' } }));
  return bytes;
}

async function getSession(onStatus: (m: string) => void): Promise<ort.InferenceSession> {
  const cached = sessions.get(MODEL_FILE);
  if (cached) return cached;
  const bytes = await fetchModelWithProgress(onStatus);
  onStatus('Menyiapkan sesi ONNX…');
  // WebGPU bila tersedia (init & inferensi lebih cepat), fallback WASM.
  const eps: string[] = [];
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) eps.push('webgpu');
  eps.push('wasm');
  const session = await ort.InferenceSession.create(bytes, { executionProviders: eps });
  sessions.set(MODEL_FILE, session);
  onStatus('Sesi siap. Menginferensi…');
  return session;
}

async function convert(data: ArrayBuffer, onStatus: (m: string) => void): Promise<Blob> {
  const size = U2NETP_INPUT_SIZE;
  const session = await getSession(onStatus);
  onStatus('Menganalisis gambar dengan model AI…');

  const bitmap = await createImageBitmap(new Blob([data]));
  const inputCanvas = new OffscreenCanvas(size, size);
  const inputCtx = inputCanvas.getContext('2d')!;
  inputCtx.drawImage(bitmap, 0, 0, size, size);
  const px = inputCtx.getImageData(0, 0, size, size).data;

  // NCHW float32, normalisasi (x/255 − 0.5) / 1.0
  const tensorData = new Float32Array(3 * size * size);
  const plane = size * size;
  for (let i = 0; i < plane; i++) {
    tensorData[i] = (px[i * 4] / 255 - 0.5) / 1.0;
    tensorData[plane + i] = (px[i * 4 + 1] / 255 - 0.5) / 1.0;
    tensorData[2 * plane + i] = (px[i * 4 + 2] / 255 - 0.5) / 1.0;
  }
  const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', tensorData, [1, 3, size, size]) };
  const output = await session.run(feeds);
  const matteRaw = output[session.outputNames[0]].data as Float32Array;
  const matte = minMaxNormalize(matteRaw.subarray(0, plane));

  // Mask alpha (S×S) → komposit ke gambar asli berukuran penuh.
  const maskCanvas = new OffscreenCanvas(size, size);
  const maskCtx = maskCanvas.getContext('2d')!;
  const maskData = maskCtx.createImageData(size, size);
  for (let i = 0; i < plane; i++) {
    maskData.data[i * 4] = 255;
    maskData.data[i * 4 + 1] = 255;
    maskData.data[i * 4 + 2] = 255;
    maskData.data[i * 4 + 3] = Math.round(matte[i] * 255);
  }
  maskCtx.putImageData(maskData, 0, 0);

  const out = new OffscreenCanvas(bitmap.width, bitmap.height);
  const outCtx = out.getContext('2d')!;
  outCtx.drawImage(bitmap, 0, 0);
  outCtx.globalCompositeOperation = 'destination-in';
  outCtx.drawImage(maskCanvas, 0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return out.convertToBlob({ type: 'image/png' });
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { type?: string; data?: ArrayBuffer } | undefined;
  if (!msg || msg.type !== 'convert' || !msg.data) return;
  try {
    const blob = await convert(msg.data, (message) => post({ type: 'status', message }));
    post({ type: 'result', blob });
  } catch (err) {
    post({ type: 'error', error: String((err as Error)?.message ?? err) });
  }
};

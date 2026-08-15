import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_RENDER_PAGES = 200;
const MAX_RENDER_BYTES = 100 * 1024 * 1024;

export interface PdfToImageOptions {
  format?: 'png' | 'jpeg';
  scale?: number;
  quality?: number;
  pages?: number[];
}

export interface ExtractTextResult {
  text: string;
  pages: number;
}

async function loadPdfDoc(bytes: ArrayBuffer) {
  if (bytes.byteLength > MAX_RENDER_BYTES) throw new Error('File terlalu besar untuk dirender di browser.');
  const doc = await getDocument({ data: bytes.slice(0) }).promise;
  if (doc.numPages > MAX_RENDER_PAGES) throw new Error(`Terlalu banyak halaman (${doc.numPages}). Maksimal ${MAX_RENDER_PAGES}.`);
  return doc;
}

/**
 * Render halaman PDF menjadi gambar. Mengembalikan array Blob (image/png atau image/jpeg).
 */
export async function pdfToImages(
  bytes: ArrayBuffer,
  opts: PdfToImageOptions = {},
  onProgress?: (current: number, total: number) => void,
): Promise<Blob[]> {
  const format = opts.format ?? 'png';
  const scale = opts.scale ?? 2;
  const quality = opts.quality ?? 0.92;
  const pageFilter = opts.pages;

  const doc = await loadPdfDoc(bytes);
  const total = pageFilter ? pageFilter.length : doc.numPages;
  const results: Blob[] = [];

  for (let i = 0; i < total; i++) {
    const pageNum = pageFilter ? pageFilter[i] + 1 : i + 1;
    if (pageNum < 1 || pageNum > doc.numPages) continue;
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context tidak tersedia di browser ini.');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), `image/${format}`, quality);
    });
    results.push(blob);
    onProgress?.(i + 1, total);
  }

  await doc.destroy();
  if (!results.length) throw new Error('Tidak ada halaman yang dapat dirender.');
  return results;
}

/**
 * Ekstrak teks dari PDF. Mengembalikan teks gabungan semua halaman.
 */
export async function extractText(
  bytes: ArrayBuffer,
  onProgress?: (current: number, total: number) => void,
): Promise<ExtractTextResult> {
  const doc = await loadPdfDoc(bytes);
  const total = doc.numPages;
  const parts: string[] = [];

  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) parts.push(text);
    onProgress?.(i, total);
  }

  await doc.destroy();
  return { text: parts.join('\n\n'), pages: total };
}

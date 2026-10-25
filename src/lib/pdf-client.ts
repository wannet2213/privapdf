import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { PDFDocument, type PDFRef } from 'pdf-lib';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { tr } from './i18n';

GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_RENDER_PAGES = 200;
const MAX_RENDER_BYTES = 100 * 1024 * 1024;

export interface PdfToImageOptions {
  format?: 'png' | 'jpeg';
  scale?: number;
  quality?: number;
  pages?: number[];
  /** Gambar di atas halaman sebelum di-encode; koordinat dalam poin halaman (kiri-atas = 0,0). */
  draw?: (ctx: CanvasRenderingContext2D, pageIndex: number) => void;
}

export interface ExtractTextResult {
  text: string;
  pages: number;
}

export const PAGE_ORDER_MISMATCH = tr('Susunan halaman PDF ini rusak: halaman yang ditampilkan tidak sama dengan yang akan diproses, jadi file ditolak agar tidak salah halaman. Simpan ulang PDF-nya (mis. Cetak → Simpan sebagai PDF), lalu coba lagi.', 'This PDF page tree is broken: the pages shown differ from the pages that would be processed, so the file is rejected to avoid working on the wrong page. Re-save the PDF (e.g. Print → Save as PDF), then try again.');

/**
 * Preview (pdf.js) dan mesin (pdf-lib) membaca page tree dengan aturan berbeda: pdf.js memakai /Count
 * dan menganggap node tanpa /Kids sebagai halaman, pdf-lib hanya mengenal /Type /Page. Pada page tree
 * cacat, halaman ke-i di preview bisa bukan halaman ke-i yang diproses — Sensor lalu menempel kotak di
 * halaman lain dan halaman yang ditandai lolos sebagai teks. Bandingkan ref tiap halaman, bukan jumlahnya:
 * jumlah bisa sama dengan urutan berbeda.
 */
export async function assertSamePageOrder(bytes: ArrayBuffer): Promise<void> {
  let refs: PDFRef[];
  let doc: Awaited<ReturnType<typeof getDocument>['promise']>;
  try {
    refs = (await PDFDocument.load(bytes, { updateMetadata: false })).getPages().map((p) => p.ref);
    doc = await getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
  } catch {
    return; // Terkunci/rusak: panel dan mesin melaporkan galatnya sendiri, tanpa ada halaman yang bisa dipilih.
  }
  try {
    let same = doc.numPages === refs.length;
    for (let i = 0; same && i < refs.length; i++) {
      const ref = (await doc.getPage(i + 1).catch(() => undefined))?.ref;
      same = ref?.num === refs[i].objectNumber && ref.gen === refs[i].generationNumber;
    }
    if (!same) throw new Error(PAGE_ORDER_MISMATCH);
  } finally {
    void doc.destroy();
  }
}

export async function loadPdfDoc(bytes: ArrayBuffer) {
  if (bytes.byteLength > MAX_RENDER_BYTES) throw new Error(tr('File terlalu besar untuk dirender di browser.', 'The file is too large to render in the browser.'));
  const doc = await getDocument({ data: bytes.slice(0) }).promise;
  if (doc.numPages > MAX_RENDER_PAGES) throw new Error(tr(`Terlalu banyak halaman (${doc.numPages}). Maksimal ${MAX_RENDER_PAGES}.`, `Too many pages (${doc.numPages}). Maximum ${MAX_RENDER_PAGES}.`));
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
    if (!ctx) throw new Error(tr('Canvas 2D context tidak tersedia di browser ini.', 'Canvas 2D context is not available in this browser.'));
    // intent 'print' tidak memakai requestAnimationFrame, yang berhenti di tab latar belakang.
    // Konsekuensinya tampilan mengikuti versi cetak: anotasi tanpa flag Print tidak ikut,
    // anotasi khusus cetak (NoView+Print) ikut. Pratinjau Sensor PDF memakai intent yang sama.
    await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
    if (opts.draw) { ctx.setTransform(scale, 0, 0, scale, 0, 0); opts.draw(ctx, pageNum - 1); }
    // toBlob memberi null bila canvas melebihi batas browser (mis. halaman besar pada 3x).
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, `image/${format}`, quality));
    canvas.width = 0; canvas.height = 0;
    page.cleanup();
    if (!blob) throw new Error(tr(`Halaman ${pageNum} terlalu besar untuk dirender pada resolusi ini. Coba resolusi lebih rendah.`, `Page ${pageNum} is too large to render at this resolution. Try a lower resolution.`));
    results.push(blob);
    onProgress?.(i + 1, total);
  }

  await doc.destroy();
  if (!results.length) throw new Error(tr('Tidak ada halaman yang dapat dirender.', 'No pages could be rendered.'));
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

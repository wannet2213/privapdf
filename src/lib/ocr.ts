import { createWorker, OEM, type Line } from 'tesseract.js';
import type { PageViewport } from 'pdfjs-dist';
import { loadPdfDoc } from './pdf-client';
import type { TextLayerWord } from '../engines/pdf-native';
import { tr } from './i18n';

// Render 216 dpi: cukup untuk teks ukuran normal tanpa canvas raksasa.
const OCR_SCALE = 3;
// ponytail: heuristik — halaman dengan teks sebanyak ini dianggap sudah punya lapisan teks dan
// dilewati (mencegah teks ganda). Halaman scan yang cuma diberi nomor halaman tetap di-OCR.
const EXISTING_TEXT_MIN = 100;

export interface OcrPage {
  words: TextLayerWord[];
  text: string;
  /** Halaman sudah berisi teks sehingga tidak di-OCR. */
  skipped: boolean;
}

export async function ocrPdf(bytes: ArrayBuffer, onStatus: (status: string) => void): Promise<OcrPage[]> {
  onStatus(tr('Memuat mesin OCR…', 'Loading the OCR engine…'));
  let current = '';
  // Aset disajikan sendiri dari public/tesseract (npm run setup:ocr) — bukan CDN bawaan tesseract.js.
  const worker = await createWorker(['ind', 'eng'], OEM.LSTM_ONLY, {
    workerPath: '/tesseract/worker.min.js',
    corePath: '/tesseract/core',
    langPath: '/tesseract/lang',
    workerBlobURL: false,
    logger: (m) => { if (current && m.status === 'recognizing text') onStatus(`${current} ${Math.round(m.progress * 100)}%`); },
  }).catch(() => { throw new Error(tr('Mesin OCR gagal dimuat. Aset OCR belum dipasang di server ini (npm run setup:ocr).', 'The OCR engine failed to load. OCR assets are not installed on this server (npm run setup:ocr).')); });

  let doc: Awaited<ReturnType<typeof loadPdfDoc>> | undefined;
  try {
    doc = await loadPdfDoc(bytes);
    const pages: OcrPage[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const existing = (await page.getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join(' ').trim();
      if (existing.replace(/\s/g, '').length >= EXISTING_TEXT_MIN) {
        pages.push({ words: [], text: existing, skipped: true });
        continue;
      }
      current = tr(`OCR halaman ${i}/${doc.numPages}…`, `OCR page ${i}/${doc.numPages}…`);
      onStatus(current);
      const viewport = page.getViewport({ scale: OCR_SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error(tr('Canvas 2D context tidak tersedia di browser ini.', 'Canvas 2D context is not available in this browser.'));
      // intent 'print' tidak memakai requestAnimationFrame, yang berhenti di tab latar belakang —
      // OCR banyak halaman tetap jalan walau pengguna pindah tab sambil menunggu.
      await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
      const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
      canvas.width = 0; canvas.height = 0;
      page.cleanup();
      const lines = (data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((p) => p.lines));
      pages.push({ words: lines.flatMap((line) => lineWords(line, viewport)), text: data.text.trim(), skipped: false });
    }
    return pages;
  } finally {
    await worker.terminate();
    await doc?.destroy();
  }
}

/** Kata dalam satu baris → koordinat PDF. convertToPdfPoint ikut menangani /Rotate dan CropBox. */
function lineWords(line: Line, viewport: PageViewport): TextLayerWord[] {
  const size = (line.bbox.y1 - line.bbox.y0) / OCR_SCALE;
  const { x0, y0, x1, y1 } = line.baseline;
  return line.words.filter((w) => w.text.trim()).map((w) => {
    const baseline = x1 > x0 ? y0 + ((y1 - y0) * (w.bbox.x0 - x0)) / (x1 - x0) : w.bbox.y1;
    const [x, y] = viewport.convertToPdfPoint(w.bbox.x0, baseline);
    return { text: w.text, x, y, size, width: (w.bbox.x1 - w.bbox.x0) / OCR_SCALE, rotation: viewport.rotation };
  });
}

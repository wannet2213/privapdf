import {
  PDFDocument, PDFDict, PDFArray, PDFName, PDFRef, PDFStream, PDFRawStream, decodePDFRawStream, type PDFContext, type PDFObject, degrees,
  pushGraphicsState, popGraphicsState, beginText, endText, setTextRenderingMode, TextRenderingMode,
  setFontAndSize, setCharacterSqueeze, rotateAndSkewTextDegreesAndTranslate, showText, StandardFonts, rgb, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { createPdfToolkit, PdfPasswordError, type PdfToolkit } from 'pdfstudio';
import { parseOps, type Op } from '../lib/content-stream';

let unlockToolkitPromise: Promise<PdfToolkit> | undefined;
function getUnlockToolkit() {
  if (!unlockToolkitPromise) {
    unlockToolkitPromise = createPdfToolkit().catch((error) => {
      unlockToolkitPromise = undefined;
      throw error;
    });
  }
  return unlockToolkitPromise;
}

export async function mergePdf(inputs: ArrayBuffer[]): Promise<ArrayBuffer> {
  const out = await PDFDocument.create();
  for (const bytes of inputs) {
    const doc = await PDFDocument.load(bytes);
    const pages = await out.copyPages(doc, doc.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return (await out.save()).buffer as ArrayBuffer;
}

/** Split per halaman: hasilkan satu PDF per halaman (0-based index list). */
export async function splitPdfEach(input: ArrayBuffer, indices: number[]): Promise<ArrayBuffer[]> {
  const doc = await PDFDocument.load(input);
  const pageCount = doc.getPageCount();
  const valid = indices.filter((i) => i >= 0 && i < pageCount);
  if (!valid.length) throw new Error('Tidak ada halaman valid untuk diekstrak.');
  const outputs: ArrayBuffer[] = [];
  for (const index of valid) outputs.push(await extractPages(doc, [index]));
  return outputs;
}

/** Split berdasarkan rentang: setiap rentang [start,end] inklusif menjadi satu PDF. */
export async function splitPdfRanges(input: ArrayBuffer, ranges: [number, number][]): Promise<ArrayBuffer[]> {
  const doc = await PDFDocument.load(input);
  const pageCount = doc.getPageCount();
  const outputs: ArrayBuffer[] = [];
  for (const [start, end] of ranges) {
    if (start < 0 || end >= pageCount || start > end) {
      throw new Error(`Rentang ${start + 1}-${end + 1} tidak valid untuk ${pageCount} halaman.`);
    }
    const indices: number[] = [];
    for (let i = start; i <= end; i++) indices.push(i);
    outputs.push(await extractPages(doc, indices));
  }
  return outputs;
}

/** Split berdasarkan kelompok halaman acak. */
export async function splitPdfGroups(input: ArrayBuffer, groups: number[][]): Promise<ArrayBuffer[]> {
  const doc = await PDFDocument.load(input);
  const pageCount = doc.getPageCount();
  const outputs: ArrayBuffer[] = [];
  for (const group of groups) {
    if (!group.length) continue;
    for (const idx of group) {
      if (idx < 0 || idx >= pageCount) {
        throw new Error(`Halaman ${idx + 1} berada di luar batas dokumen (${pageCount} halaman).`);
      }
    }
    outputs.push(await extractPages(doc, group));
  }
  if (!outputs.length) throw new Error('Tidak ada kelompok halaman valid.');
  return outputs;
}

/** Legacy alias. */
export async function splitPdf(input: ArrayBuffer, indices: number[]): Promise<ArrayBuffer[]> {
  return splitPdfEach(input, indices);
}

export interface RotateOptions {
  /** Sudut relatif dalam derajat (90/180/270, nilai lain dinormalisasi). */
  angle: number;
  /** Indeks halaman 0-based yang dirotasi; kosong = semua halaman. */
  pages?: number[];
}

export async function rotatePdf(input: ArrayBuffer, angleOrOpts: number | RotateOptions): Promise<ArrayBuffer> {
  const opts = typeof angleOrOpts === 'number' ? { angle: angleOrOpts } : angleOrOpts;
  const angle = ((opts.angle % 360) + 360) % 360; // normalisasi ke 0-359
  const doc = await PDFDocument.load(input);
  const pages = doc.getPages();

  if (opts.pages?.length) {
    for (const i of opts.pages) {
      if (!Number.isInteger(i) || i < 0 || i >= pages.length) {
        throw new Error(`Indeks halaman rotasi tidak valid: ${i}`);
      }
    }
    for (const i of new Set(opts.pages)) {
      pages[i].setRotation(degrees((pages[i].getRotation().angle + angle) % 360));
    }
  } else {
    pages.forEach((p) => p.setRotation(degrees((p.getRotation().angle + angle) % 360)));
  }
  return (await doc.save()).buffer as ArrayBuffer;
}

export async function imageToPdf(input: ArrayBuffer, type: 'png' | 'jpg'): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  const image = type === 'png' ? await doc.embedPng(input) : await doc.embedJpg(input);
  const page = doc.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  return (await doc.save()).buffer as ArrayBuffer;
}

/** Susun PDF dari JPEG hasil render halaman; ukuran halaman kembali ke poin asli (piksel / skala render). */
export async function jpegsToPdf(jpgs: ArrayBuffer[], scale: number): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  for (const jpg of jpgs) await addJpegPage(doc, jpg, scale);
  doc.setProducer('PrivaPDF');
  return (await doc.save({ useObjectStreams: true })).buffer as ArrayBuffer;
}

async function addJpegPage(doc: PDFDocument, jpg: ArrayBuffer, scale: number) {
  const image = await doc.embedJpg(jpg);
  const page = doc.addPage([image.width / scale, image.height / scale]);
  page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
}

// Kunci halaman yang aman disalin. Sisanya (Annots, B, AA, …) bisa merantai ke data halaman
// tersensor, mis. balasan komentar (/IRT) atau field formulir (/Kids) yang nilainya ada di sana.
const REDACT_PAGE_KEYS = new Set(['Type', 'Parent', 'MediaBox', 'CropBox', 'BleedBox', 'TrimBox', 'ArtBox', 'Rotate', 'Contents', 'Resources', 'Group', 'UserUnit']);

const UNREADABLE_CONTENT = 'Isi salah satu halaman tidak bisa dibaca, jadi tidak bisa dipastikan sisa halaman lain ikut terbuang. Proses dibatalkan.';
const RESOURCES = PDFName.of('Resources');
const RESOURCE_CATEGORIES = new Set(['Font', 'XObject', 'ExtGState', 'Shading', 'ColorSpace', 'Pattern', 'Properties']);

/** Kategori dan nama resource yang dipanggil satu operator content stream. */
function resourceUse({ operator, operands: a }: Op): [string, unknown] | undefined {
  switch (operator) {
    case 'Tf': return ['Font', a[0]];
    case 'Do': return ['XObject', a[0]];
    case 'gs': return ['ExtGState', a[0]];
    case 'sh': return ['Shading', a[0]];
    case 'cs': case 'CS': return ['ColorSpace', a[0]];
    case 'scn': case 'SCN': return ['Pattern', a[a.length - 1]];
    case 'BDC': case 'DP': return ['Properties', a[1]];
  }
}

// lookupMaybe melempar bila tipenya lain; di PDF cacat cukup dianggap tidak ada.
const dictAt = (ctx: PDFContext, o: PDFObject | undefined) => { const v = ctx.lookup(o); return v instanceof PDFDict ? v : undefined; };
const arrayAt = (ctx: PDFContext, o: PDFObject | undefined) => { const v = ctx.lookup(o); return v instanceof PDFArray ? v.asArray() : undefined; };

/** Isi stream (atau array stream) yang sudah didekode, disambung dengan pemisah baris. Gagal-tertutup. */
function contentOf(ctx: PDFContext, obj: PDFObject | PDFObject[] | undefined): Uint8Array {
  const items = Array.isArray(obj) ? obj : arrayAt(ctx, obj) ?? (obj ? [obj] : []);
  const parts = items.map((item) => {
    const s = ctx.lookup(item);
    if (s === undefined) return new Uint8Array();
    if (!(s instanceof PDFRawStream)) throw new Error(UNREADABLE_CONTENT);
    try { return decodePDFRawStream(s).decode(); } catch { throw new Error(UNREADABLE_CONTENT); }
  });
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length + 1, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; out[offset++] = 10; }
  return out;
}

const type3Procs = (ctx: PDFContext, font: PDFDict) => contentOf(ctx, dictAt(ctx, font.get(PDFName.of('CharProcs')))?.values() ?? []);
const isType3 = (o: unknown): o is PDFDict => o instanceof PDFDict && o.get(PDFName.of('Subtype')) === PDFName.of('Type3');

/**
 * Bangun ulang /Resources milik `holder` (halaman, Form XObject, pola, font Type3, appearance) hanya
 * dengan nama yang benar-benar dipanggil isinya, lalu turun ke objek yang dipanggil. Resources yang
 * dipakai bersama halaman lain tidak diubah — tiap holder mendapat dict sendiri — sehingga gambar,
 * pola, ExtGState, atau property list milik halaman yang dibuang tidak lagi terjangkau.
 */
function pruneResources(ctx: PDFContext, holder: PDFDict, content: Uint8Array, seen: Set<PDFDict>) {
  if (seen.has(holder)) return;
  seen.add(holder);
  const res = dictAt(ctx, holder.get(RESOURCES));
  if (!res) return;
  const category = (cat: string) => dictAt(ctx, res.get(PDFName.of(cat)));
  const used = new Map<string, Set<string>>();
  let inlineImage = false;
  // Form XObject / font Type3 tanpa Resources sendiri memakai Resources pemanggilnya: pindai di sini juga.
  const queue = [content];
  const inherited = new Set<PDFObject>();
  while (queue.length) {
    for (const op of parseOps(queue.pop()!)) {
      if (op.operator === 'BI') inlineImage = true;
      const use = resourceUse(op);
      if (!use || typeof use[1] !== 'string') continue;
      const [cat, name] = use as [string, string];
      if (!used.has(cat)) used.set(cat, new Set());
      used.get(cat)!.add(name);
      const obj = ctx.lookup(category(cat)?.get(PDFName.of(name)));
      if (!obj || inherited.has(obj)) continue;
      if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Form') && !obj.dict.has(RESOURCES)) {
        inherited.add(obj);
        queue.push(contentOf(ctx, obj));
      } else if (isType3(obj) && !obj.has(RESOURCES)) {
        inherited.add(obj);
        queue.push(type3Procs(ctx, obj));
      }
    }
  }

  const pruned = ctx.obj({}) as PDFDict;
  for (const [key, value] of res.entries()) {
    const cat = key.decodeText();
    // Dict inline image (BI … ID) tidak di-tokenize, jadi nama color space-nya tidak terlihat: simpan semua.
    if (!RESOURCE_CATEGORIES.has(cat) || (cat === 'ColorSpace' && inlineImage)) { pruned.set(key, value); continue; }
    const kept = ctx.obj({}) as PDFDict;
    for (const name of used.get(cat) ?? []) {
      const entry = category(cat)?.get(PDFName.of(name));
      if (entry) kept.set(PDFName.of(name), entry);
    }
    if (kept.keys().length) pruned.set(key, kept);
  }
  holder.set(RESOURCES, pruned);

  for (const [cat, names] of used) {
    for (const name of names) {
      const obj = ctx.lookup(category(cat)?.get(PDFName.of(name)));
      if (obj instanceof PDFRawStream) pruneResources(ctx, obj.dict, contentOf(ctx, obj), seen); // form, pola tiling
      else if (isType3(obj)) pruneResources(ctx, obj, type3Procs(ctx, obj), seen);
      else if (cat === 'ExtGState' && obj instanceof PDFDict) {
        const smask = dictAt(ctx, obj.get(PDFName.of('SMask')));
        const group = smask && ctx.lookup(smask.get(PDFName.of('G')));
        if (group instanceof PDFRawStream) pruneResources(ctx, group.dict, contentOf(ctx, group), seen);
      }
    }
  }
}

/**
 * pdf-lib copyPages menyalin semua yang dirujuk halaman. Putus rantai dict biasa dari halaman yang
 * disalin ke anotasi/field halaman yang tidak ikut — qpdf --pages hanya me-null-kan rujukan ke
 * halaman, bukan ke dict ini: balasan /IRT, Popup, field formulir yang widget-nya di halaman lain
 * (nilainya ada di sana), dan bead artikel /B.
 */
function detachDroppedPages(out: PDFDocument) {
  const ctx = out.context;
  const annots = new Set<PDFObject>();
  for (const page of out.getPages()) {
    page.node.delete(PDFName.of('B'));
    for (const ref of arrayAt(ctx, page.node.get(PDFName.of('Annots'))) ?? []) annots.add(ref);
  }
  // Field yang masih punya widget di halaman yang disalin.
  const live = new Set<PDFDict>();
  for (const ref of annots) {
    for (let d = dictAt(ctx, ref); d && !live.has(d); d = dictAt(ctx, d.get(PDFName.of('Parent')))) live.add(d);
  }
  for (const field of live) {
    const kids = arrayAt(ctx, field.get(PDFName.of('Kids')));
    if (!kids) continue;
    const keep = kids.filter((k) => { const d = dictAt(ctx, k); return d !== undefined && live.has(d); });
    field.set(PDFName.of('Kids'), ctx.obj(keep));
  }
  for (const ref of annots) {
    const annot = dictAt(ctx, ref);
    if (!annot) continue;
    for (const key of ['IRT', 'Popup']) if (annot.has(PDFName.of(key)) && !annots.has(annot.get(PDFName.of(key))!)) annot.delete(PDFName.of(key));
    if (annot.get(PDFName.of('Subtype')) === PDFName.of('Popup') && annot.has(PDFName.of('Parent')) && !annots.has(annot.get(PDFName.of('Parent'))!)) annot.delete(PDFName.of('Parent'));
  }
}

/**
 * Selesaikan dokumen hasil salin-halaman: putus rantai ke halaman yang tidak ikut, pangkas Resources
 * tiap halaman (dan appearance anotasinya) ke yang dipanggil isinya, lalu tulis lewat qpdf --pages
 * yang me-null-kan rujukan ke halaman lain dan hanya menulis objek yang masih terjangkau.
 * Hanya jalan di worker: CSP halaman memblokir kompilasi WASM.
 */
async function savePagesOnly(out: PDFDocument, pages = out.getPages()): Promise<ArrayBuffer> {
  const ctx = out.context;
  detachDroppedPages(out);
  const seen = new Set<PDFDict>();
  for (const page of pages) {
    pruneResources(ctx, page.node, contentOf(ctx, page.node.get(PDFName.of('Contents'))), seen);
    for (const ref of arrayAt(ctx, page.node.get(PDFName.of('Annots'))) ?? []) {
      const ap = dictAt(ctx, dictAt(ctx, ref)?.get(PDFName.of('AP')));
      for (const state of ap?.values() ?? []) {
        const s = ctx.lookup(state);
        for (const x of s instanceof PDFDict ? s.values().map((v) => ctx.lookup(v)) : [s]) {
          if (x instanceof PDFRawStream) pruneResources(ctx, x.dict, contentOf(ctx, x), seen);
        }
      }
    }
  }
  const toolkit = await getUnlockToolkit();
  return toArrayBuffer(await toolkit.raw([await out.save()], ['--empty', '--pages', '$in0', '1-z', '--', '--remove-unreferenced-resources=yes', '--object-streams=generate', '$out']));
}

/** Salin halaman terpilih (urutan sesuai `indices`) ke dokumen baru tanpa isi halaman lain. */
async function extractPages(doc: PDFDocument, indices: number[]): Promise<ArrayBuffer> {
  const out = await PDFDocument.create();
  for (const page of await out.copyPages(doc, indices)) out.addPage(page);
  return savePagesOnly(out);
}

/**
 * Ganti halaman tersensor dengan gambarnya (kotak hitam sudah tertanam di piksel). Halaman lain
 * disalin tanpa anotasi ke dokumen baru — info dokumen, bookmark, dan formulir tidak ikut.
 */
export async function redactPdf(input: ArrayBuffer, jpgs: Map<number, ArrayBuffer>, scale: number): Promise<ArrayBuffer> {
  const src = await PDFDocument.load(input);
  // Indeks di luar dokumen berarti preview dan mesin tidak sepakat soal halaman: jangan diam-diam lewat.
  for (const i of jpgs.keys()) if (!Number.isInteger(i) || i < 0 || i >= src.getPageCount()) throw new Error(`Halaman ${i + 1} yang disensor tidak ada di dokumen.`);
  for (const page of src.getPages()) {
    for (const [key] of page.node.entries()) if (!REDACT_PAGE_KEYS.has(key.decodeText())) page.node.delete(key);
  }
  const out = await PDFDocument.create();
  const kept = await out.copyPages(src, src.getPageIndices().filter((i) => !jpgs.has(i)));
  const copied = [...kept];
  for (const i of src.getPageIndices()) {
    const jpg = jpgs.get(i);
    if (jpg) await addJpegPage(out, jpg, scale);
    else out.addPage(kept.shift()!);
  }
  // Resources bisa dipakai bersama halaman tersensor: pangkas per halaman salinan sebelum ditulis.
  return savePagesOnly(out, copied);
}

/** Hapus halaman berdasarkan index 0-based. */
export async function deletePages(input: ArrayBuffer, indices: number[]): Promise<ArrayBuffer> {
  const doc = await PDFDocument.load(input);
  const pageCount = doc.getPageCount();
  const toDelete = new Set(indices.filter((i) => i >= 0 && i < pageCount));
  const keep = Array.from({ length: pageCount }, (_, i) => i).filter((i) => !toDelete.has(i));
  if (!keep.length) throw new Error('Tidak dapat menghapus semua halaman dari dokumen.');
  return extractPages(doc, keep);
}

/** Urutkan ulang halaman berdasarkan array index 0-based baru. */
export async function reorderPages(input: ArrayBuffer, order: number[]): Promise<ArrayBuffer> {
  const doc = await PDFDocument.load(input);
  const pageCount = doc.getPageCount();
  const valid = order.filter((i) => i >= 0 && i < pageCount);
  if (!valid.length) throw new Error('Urutan halaman tidak valid.');
  const out = await PDFDocument.create();
  const pages = await out.copyPages(doc, valid);
  pages.forEach((p) => out.addPage(p));
  return (await out.save()).buffer as ArrayBuffer;
}

/** Konversi hex (#rrggbb) ke komponen rgb 0-1. Fallback abu-abu jika gagal. */
export function hexToRgb(hex?: string): { r: number; g: number; b: number } {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec((hex || '').trim());
  if (m) return { r: parseInt(m[1], 16) / 255, g: parseInt(m[2], 16) / 255, b: parseInt(m[3], 16) / 255 };
  return { r: 0.2, g: 0.2, b: 0.2 };
}

/** Definisi font — mendukung standard PDF fonts dan custom fonts. */
export interface FontDef {
  id: string;
  label: string;
  /** CSS font-family utama tanpa fallback (untuk document.fonts.load). */
  family: string;
  /** CSS font-family string lengkap dengan fallback (untuk ctx.font). */
  cssFamily: string;
  /** CSS font-weight ('normal' | 'bold' | number). */
  cssWeight: string;
  /** CSS font-style ('normal' | 'italic' | 'oblique'). */
  cssStyle: string;
  /** StandardFonts pdf-lib (untuk font bawaan PDF). */
  standard?: StandardFonts;
  /** Path TTF self-hosted (public/fonts) untuk embed pdf-lib. */
  ttfUrl?: string;
}

/** Buat string ctx.font canvas yang valid: "[style] [weight] [size]px [family]". */
export function canvasFont(def: FontDef, sizePx: number): string {
  return `${def.cssStyle} ${def.cssWeight} ${sizePx}px ${def.cssFamily}`;
}

/** Semua font yang tersedia. */
export const FONTS: FontDef[] = [
  // Standard PDF fonts
  { id: 'helvetica', label: 'Helvetica', family: 'Helvetica', cssFamily: 'Helvetica, Arial, sans-serif', cssWeight: 'normal', cssStyle: 'normal', standard: StandardFonts.Helvetica },
  { id: 'helvetica-bold', label: 'Helvetica Bold', family: 'Helvetica', cssFamily: 'Helvetica, Arial, sans-serif', cssWeight: 'bold', cssStyle: 'normal', standard: StandardFonts.HelveticaBold },
  { id: 'helvetica-italic', label: 'Helvetica Italic', family: 'Helvetica', cssFamily: 'Helvetica, Arial, sans-serif', cssWeight: 'normal', cssStyle: 'italic', standard: StandardFonts.HelveticaOblique },
  { id: 'times', label: 'Times Roman', family: '"Times New Roman"', cssFamily: '"Times New Roman", Times, serif', cssWeight: 'normal', cssStyle: 'normal', standard: StandardFonts.TimesRoman },
  { id: 'times-bold', label: 'Times Bold', family: '"Times New Roman"', cssFamily: '"Times New Roman", Times, serif', cssWeight: 'bold', cssStyle: 'normal', standard: StandardFonts.TimesRomanBold },
  { id: 'times-italic', label: 'Times Italic', family: '"Times New Roman"', cssFamily: '"Times New Roman", Times, serif', cssWeight: 'normal', cssStyle: 'italic', standard: StandardFonts.TimesRomanItalic },
  { id: 'courier', label: 'Courier', family: '"Courier New"', cssFamily: '"Courier New", Courier, monospace', cssWeight: 'normal', cssStyle: 'normal', standard: StandardFonts.Courier },
  { id: 'courier-bold', label: 'Courier Bold', family: '"Courier New"', cssFamily: '"Courier New", Courier, monospace', cssWeight: 'bold', cssStyle: 'normal', standard: StandardFonts.CourierBold },
  { id: 'courier-italic', label: 'Courier Italic', family: '"Courier New"', cssFamily: '"Courier New", Courier, monospace', cssWeight: 'normal', cssStyle: 'italic', standard: StandardFonts.CourierOblique },
  // Custom fonts — TTF self-hosted di public/fonts, dimuat via FontFace dari ttfUrl
  { id: 'dm-sans', label: 'DM Sans', family: '"DM Sans"', cssFamily: '"DM Sans", Helvetica, Arial, sans-serif', cssWeight: 'normal', cssStyle: 'normal', ttfUrl: '/fonts/dm-sans-400.ttf' },
  { id: 'dm-sans-bold', label: 'DM Sans Bold', family: '"DM Sans"', cssFamily: '"DM Sans", Helvetica, Arial, sans-serif', cssWeight: 'bold', cssStyle: 'normal', ttfUrl: '/fonts/dm-sans-700.ttf' },
  { id: 'dm-mono', label: 'DM Mono', family: '"DM Mono"', cssFamily: '"DM Mono", "Courier New", monospace', cssWeight: 'normal', cssStyle: 'normal', ttfUrl: '/fonts/dm-mono-400.ttf' },
  { id: 'playfair', label: 'Playfair Display', family: '"Playfair Display"', cssFamily: '"Playfair Display", Georgia, serif', cssWeight: 'normal', cssStyle: 'normal', ttfUrl: '/fonts/playfair-400.ttf' },
  { id: 'playfair-bold', label: 'Playfair Bold', family: '"Playfair Display"', cssFamily: '"Playfair Display", Georgia, serif', cssWeight: 'bold', cssStyle: 'normal', ttfUrl: '/fonts/playfair-700.ttf' },
];

/** Lookup cepat berdasarkan id. */
const FONT_INDEX: Record<string, FontDef> = Object.fromEntries(FONTS.map((f) => [f.id, f]));

/** Ambil FontDef berdasarkan id (fallback Helvetica). */
export function getFontDef(id?: string): FontDef {
  return FONT_INDEX[id || 'helvetica'] || FONTS[0];
}

/** Mapping id → StandardFonts untuk backward compatibility. */
export const FONT_MAP: Record<string, StandardFonts> = Object.fromEntries(
  FONTS.filter((f) => f.standard).map((f) => [f.id, f.standard!]),
);

/** CSS font-family lama untuk backward compatibility — DEPRECATED, gunakan canvasFont(). */
export const FONT_CSS: Record<string, string> = Object.fromEntries(
  FONTS.map((f) => [f.id, f.cssFamily]),
);

export const FONT_OPTIONS = FONTS.map((f) => ({ value: f.id, label: f.label }));

// Cache TTF bytes untuk custom fonts
const ttfCache = new Map<string, ArrayBuffer>();

/** Fetch TTF bytes untuk custom font (dengan cache in-memory). */
export async function loadFontBytes(id: string): Promise<ArrayBuffer | undefined> {
  const def = getFontDef(id);
  if (def.standard) return undefined;
  if (!def.ttfUrl) return undefined;
  if (ttfCache.has(id)) return ttfCache.get(id);
  try {
    const res = await fetch(def.ttfUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    ttfCache.set(id, buf);
    return buf;
  } catch {
    return undefined;
  }
}

/** Osi penomoran halaman. */
export interface PageNumberOptions {
  position?: 'bottom-center' | 'bottom-left' | 'bottom-right' | 'top-center' | 'top-left' | 'top-right';
  fontSize?: number;
  startFrom?: number;
  margin?: number;
  format?: 'number' | 'page-of' | 'roman';
  color?: string;
  font?: string;
}

function toRoman(num: number): string {
  const map: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let result = '';
  for (const [val, sym] of map) { while (num >= val) { result += sym; num -= val; } }
  return result;
}

export async function addPageNumbers(input: ArrayBuffer, opts: PageNumberOptions = {}): Promise<ArrayBuffer> {
  const doc = await PDFDocument.load(input);
  const def = getFontDef(opts.font);
  const customBytes = def.standard ? undefined : await loadFontBytes(def.id);
  if (customBytes) doc.registerFontkit(fontkit);
  const font = customBytes ? await doc.embedFont(customBytes, { subset: true }) : await doc.embedFont(def.standard || StandardFonts.Helvetica);
  const pages = doc.getPages();
  const total = pages.length;
  const startFrom = opts.startFrom ?? 1;
  const fontSize = opts.fontSize ?? 10;
  const margin = opts.margin ?? 28;
  const position = opts.position ?? 'bottom-center';
  const format = opts.format ?? 'number';
  pages.forEach((page, i) => {
    const page_num = i + startFrom;
    let label: string;
    if (format === 'page-of') label = `${page_num} / ${total + startFrom - 1}`;
    else if (format === 'roman') label = toRoman(page_num);
    else label = String(page_num);
    const textWidth = font.widthOfTextAtSize(label, fontSize);
    const { width, height } = page.getSize();
    let x: number, y: number;
    if (position.startsWith('bottom')) {
      y = margin;
      if (position.endsWith('center')) x = (width - textWidth) / 2;
      else if (position.endsWith('left')) x = margin;
      else x = width - textWidth - margin;
    } else {
      y = height - margin - fontSize;
      if (position.endsWith('center')) x = (width - textWidth) / 2;
      else if (position.endsWith('left')) x = margin;
      else x = width - textWidth - margin;
    }
    page.drawText(label, { x, y, size: fontSize, font, color: rgb(hexToRgb(opts.color).r, hexToRgb(opts.color).g, hexToRgb(opts.color).b) });
  });
  return (await doc.save()).buffer as ArrayBuffer;
}

/** Tata letak tanda air. Isi (teks/gambar) ditentukan oleh ada-tidaknya `imageBytes`. */
export type WatermarkType = 'center' | 'tiled' | 'positioned';
export type WatermarkPosition = 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** Opsi tanda air. */
export interface WatermarkOptions {
  text?: string;
  fontSize?: number;
  opacity?: number;
  rotation?: number;
  color?: string;
  font?: string;
  type?: WatermarkType;
  position?: WatermarkPosition;
  /** Jarak antar ubin (pt). */
  tileGap?: number;
  /** Bila ada, tanda air berupa gambar (teks diabaikan). */
  imageBytes?: ArrayBuffer;
  imageType?: 'png' | 'jpg';
  /** Lebar gambar sebagai fraksi lebar halaman. */
  imageScale?: number;
  /** Jarak antar karakter (pt). 0 = normal. */
  letterSpacing?: number;
  /** Pengali tinggi baris terhadap ukuran font (multi-baris, teks dipisah \n). Default 1.2. */
  lineHeight?: number;
  /** Geser horizontal dari posisi terhitung (pt, + = kanan). */
  offsetX?: number;
  /** Geser vertikal dari posisi terhitung (pt, + = bawah, sama seperti preview). */
  offsetY?: number;
  /** Bytes font TTF/OTF yang diunggah user — menimpa pilihan `font`. */
  customFontBytes?: ArrayBuffer;
}

export interface WatermarkBox { w: number; h: number; stepX: number; stepY: number }

/**
 * Pusat setiap salinan tanda air dalam koordinat atas-ke-bawah (seperti canvas).
 * Dipakai bersama oleh engine (y dibalik) dan preview agar hasil sama persis.
 * `rotate` false untuk posisi pojok.
 */
export function watermarkCenters(
  type: WatermarkType, position: WatermarkPosition, pw: number, ph: number,
  box: WatermarkBox, margin: number, offX = 0, offY = 0,
): { x: number; y: number; rotate: boolean }[] {
  const out: { x: number; y: number; rotate: boolean }[] = [];
  const put = (x: number, y: number, rotate: boolean) => out.push({ x: x + offX, y: y + offY, rotate });
  if (type === 'tiled') {
    for (let y = box.stepY / 2; y < ph + box.stepY; y += box.stepY) {
      const rowOffset = (Math.floor(y / box.stepY) % 2) * (box.stepX / 2);
      for (let x = -box.stepX; x < pw + box.stepX; x += box.stepX) put(x + rowOffset + box.w / 2, y, true);
    }
  } else if (type === 'positioned' && position !== 'center') {
    const x = position.endsWith('left') ? margin + box.w / 2 : pw - margin - box.w / 2;
    const y = position.startsWith('top') ? margin + box.h / 2 : ph - margin - box.h / 2;
    put(x, y, false);
  } else {
    put(pw / 2, ph / 2, true);
  }
  return out;
}

/** Lebar satu baris teks termasuk letter spacing (spasi tidak ditambahkan di akhir). */
function spacedLineWidth(font: PDFFont, line: string, size: number, spacing: number): number {
  if (!line) return 0;
  let w = 0;
  for (const ch of line) w += font.widthOfTextAtSize(ch, size) + spacing;
  return w - spacing;
}

interface DrawBlockOpts {
  font: PDFFont;
  size: number;
  color: ReturnType<typeof rgb>;
  opacity: number;
  rotation: number;
  spacing: number;
  lineHeight: number;
}

/**
 * Gambar blok teks multi-baris (dipisah \n) dengan letter spacing,
 * berotasi konsisten mengelilingi sumbu teks. `cx`,`cy` = pusat visual blok.
 * Diekspor untuk pengujian posisi baris.
 */
export function drawTextBlockCentered(page: PDFPage, text: string, cx: number, cy: number, o: DrawBlockOpts) {
  const lines = text.split('\n');
  const rad = (o.rotation * Math.PI) / 180;
  // Arah baseline dan arah "bawah" relatif teks (koordinat PDF, y ke atas)
  const dirX = Math.cos(rad), dirY = Math.sin(rad);
  const downX = Math.sin(rad), downY = -Math.cos(rad);
  const lineH = o.lineHeight * o.size;

  lines.forEach((line, li) => {
    const lw = spacedLineWidth(o.font, line, o.size, o.spacing);
    // Pusat baris: digeser dari pusat blok sepanjang arah bawah teks
    const rowShift = (li - (lines.length - 1) / 2) * lineH;
    const lineCx = cx + downX * rowShift;
    const lineCy = cy + downY * rowShift;
    // Titik awal baseline: geser mundur setengah lebar sepanjang arah teks + koreksi tinggi kapital
    const capHalf = o.size * 0.35;
    let x = lineCx - (lw / 2) * dirX + capHalf * downX;
    let y = lineCy - (lw / 2) * dirY + capHalf * downY;

    if (o.spacing === 0) {
      page.drawText(line, { x, y, size: o.size, font: o.font, color: o.color, opacity: o.opacity, rotate: degrees(o.rotation) });
    } else {
      for (const ch of line) {
        page.drawText(ch, { x, y, size: o.size, font: o.font, color: o.color, opacity: o.opacity, rotate: degrees(o.rotation) });
        const cw = o.font.widthOfTextAtSize(ch, o.size) + o.spacing;
        x += cw * dirX;
        y += cw * dirY;
      }
    }
  });
}

export async function addWatermark(input: ArrayBuffer, opts: WatermarkOptions): Promise<ArrayBuffer> {
  const doc = await PDFDocument.load(input);
  const pages = doc.getPages();
  const opacity = opts.opacity ?? 0.25;
  const rotation = opts.rotation ?? 45;
  const c = hexToRgb(opts.color ?? '#808080');
  const type = opts.type ?? 'center';
  const position = opts.position ?? 'center';
  const offX = opts.offsetX ?? 0;
  const offY = opts.offsetY ?? 0;
  const margin = 40;

  if (opts.imageBytes) {
    const image = opts.imageType === 'jpg' ? await doc.embedJpg(opts.imageBytes) : await doc.embedPng(opts.imageBytes);
    const imageScale = opts.imageScale ?? 0.3;
    pages.forEach((page) => {
      const { width, height } = page.getSize();
      const w = width * imageScale;
      const h = (image.height / image.width) * w;
      const gap = opts.tileGap ?? w / 2;
      for (const p of watermarkCenters(type, position, width, height, { w, h, stepX: w + gap, stepY: h + gap }, margin, offX, offY)) {
        // pdf-lib memutar gambar di pojok kiri-bawah; geser titik awal agar putaran mengelilingi pusat
        const rot = p.rotate ? rotation : 0;
        const rad = (rot * Math.PI) / 180;
        const cy = height - p.y;
        page.drawImage(image, {
          x: p.x - (w / 2) * Math.cos(rad) + (h / 2) * Math.sin(rad),
          y: cy - (w / 2) * Math.sin(rad) - (h / 2) * Math.cos(rad),
          width: w,
          height: h,
          opacity,
          rotate: degrees(rot),
        });
      }
    });
    return (await doc.save()).buffer as ArrayBuffer;
  }

  const text = opts.text ?? '';
  if (!text.trim()) throw new Error('Teks tanda air tidak boleh kosong.');
  // Spasi huruf bisa negatif (merapatkan); dibatasi agar karakter tidak bertumpuk terbalik
  const spacing = Math.max(-(opts.fontSize ?? 50) * 0.5, opts.letterSpacing ?? 0);
  const lineHeight = opts.lineHeight ?? 1.2;

  let font: PDFFont;
  if (opts.customFontBytes) {
    doc.registerFontkit(fontkit);
    try {
      font = await doc.embedFont(opts.customFontBytes, { subset: true });
    } catch {
      throw new Error('Font yang diunggah tidak dapat diproses. Gunakan file TTF atau OTF yang valid.');
    }
  } else {
    const def = getFontDef(opts.font || 'helvetica-bold');
    const customBytes = def.standard ? undefined : await loadFontBytes(def.id);
    if (customBytes) doc.registerFontkit(fontkit);
    font = customBytes
      ? await doc.embedFont(customBytes, { subset: true })
      : await doc.embedFont(def.standard || StandardFonts.HelveticaBold);
  }

  const size = opts.fontSize ?? 50;
  const tileGap = opts.tileGap ?? size * 2.5;
  const drawOpts: DrawBlockOpts = { font, size, color: rgb(c.r, c.g, c.b), opacity, rotation, spacing, lineHeight };
  const lines = text.split('\n');
  const widest = Math.max(...lines.map((l) => spacedLineWidth(font, l, size, spacing)));
  const blockH = (lines.length - 1) * lineHeight * size;
  const box = { w: widest, h: blockH, stepX: widest + tileGap, stepY: blockH + size + tileGap };

  pages.forEach((page) => {
    const { width, height } = page.getSize();
    for (const p of watermarkCenters(type, position, width, height, box, margin, offX, offY)) {
      drawTextBlockCentered(page, text, p.x, height - p.y, p.rotate ? drawOpts : { ...drawOpts, rotation: 0 });
    }
  });
  return (await doc.save()).buffer as ArrayBuffer;
}

/** Opsi metadata. */
export interface MetadataOptions {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
}

export async function updateMetadata(input: ArrayBuffer, opts: MetadataOptions): Promise<ArrayBuffer> {
  const doc = await PDFDocument.load(input);
  if (opts.title !== undefined) doc.setTitle(opts.title);
  if (opts.author !== undefined) doc.setAuthor(opts.author);
  if (opts.subject !== undefined) doc.setSubject(opts.subject);
  if (opts.keywords !== undefined) {
    const keywords = opts.keywords.split(',').map((s) => s.trim()).filter(Boolean);
    doc.setKeywords(keywords);
  }
  if (opts.creator !== undefined) doc.setCreator(opts.creator);
  doc.setModificationDate(new Date());
  return (await doc.save()).buffer as ArrayBuffer;
}

/** Opsi crop per halaman (indeks berbasis 0). */
export interface PageCrop {
  index: number;
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

/** Opsi crop. */
export interface CropOptions {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  /** Jika diberikan, margin diterapkan per halaman (menggantikan margin global). */
  pages?: PageCrop[];
}

export async function cropPages(input: ArrayBuffer, opts: CropOptions): Promise<ArrayBuffer> {
  const doc = await PDFDocument.load(input);
  const pages = doc.getPages();

  const apply = (page: PDFPage, c: { top?: number; bottom?: number; left?: number; right?: number }) => {
    const top = c.top ?? 0;
    const bottom = c.bottom ?? 0;
    const left = c.left ?? 0;
    const right = c.right ?? 0;
    if (top < 0 || bottom < 0 || left < 0 || right < 0) throw new Error('Margin crop tidak boleh negatif.');
    const { width, height } = page.getSize();
    const newWidth = width - left - right;
    const newHeight = height - top - bottom;
    if (newWidth <= 0 || newHeight <= 0) throw new Error('Margin crop terlalu besar untuk salah satu halaman.');
    page.setCropBox(left, bottom, newWidth, newHeight);
  };

  if (opts.pages) {
    const seen = new Set<number>();
    for (const c of opts.pages) {
      if (!Number.isInteger(c.index) || c.index < 0 || c.index >= pages.length) {
        throw new Error(`Indeks halaman crop tidak valid: ${c.index}`);
      }
      if (seen.has(c.index)) throw new Error(`Indeks halaman crop duplikat: ${c.index}`);
      seen.add(c.index);
    }
    for (const c of opts.pages) apply(pages[c.index], c);
  } else {
    pages.forEach((page) => apply(page, opts));
  }
  return (await doc.save()).buffer as ArrayBuffer;
}

/** Kompres dasar: object streams + reset metadata yang tidak perlu. */
export async function compressPdf(input: ArrayBuffer): Promise<ArrayBuffer> {
  const doc = await PDFDocument.load(input);
  doc.setCreator('PrivaPDF');
  doc.setProducer('PrivaPDF');
  return (await doc.save({ useObjectStreams: true })).buffer as ArrayBuffer;
}

/** Hapus enkripsi/proteksi pakai qpdf (WASM) — mendukung user password & owner restriction. */
export async function unlockPdf(input: ArrayBuffer, password?: string): Promise<ArrayBuffer> {
  const toolkit = await getUnlockToolkit();

  // Tanpa password: coba buka langsung (menangani PDF yang punya owner restriction
  // tetapi tetap bisa dibuka tanpa password user).
  if (!password) {
    try {
      const out = await toolkit.removePassword(input, { password: '' });
      return toArrayBuffer(out);
    } catch (error) {
      if (error instanceof PdfPasswordError) {
        throw new Error('PDF ini memerlukan password untuk dibuka.');
      }
      throw error;
    }
  }

  try {
    const out = await toolkit.removePassword(input, { password });
    return toArrayBuffer(out);
  } catch (error) {
    if (error instanceof PdfPasswordError) {
      throw new Error('Password salah. Periksa kembali password PDF Anda.');
    }
    throw error;
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Opsi enkripsi PDF. */
export interface ProtectOptions {
  /** Password yang diminta saat membuka PDF. */
  password: string;
  /** Password pemilik (akses penuh). Default: sama dengan password. */
  ownerPassword?: string;
}

/** Enkripsi PDF dengan password (AES-256 via qpdf) — pasangan unlockPdf. */
export async function protectPdf(input: ArrayBuffer, opts: ProtectOptions): Promise<ArrayBuffer> {
  if (!opts.password) throw new Error('Password tidak boleh kosong.');
  const toolkit = await getUnlockToolkit();
  try {
    const out = await toolkit.lock(input, {
      userPassword: opts.password,
      ...(opts.ownerPassword ? { ownerPassword: opts.ownerPassword } : {}),
    });
    return toArrayBuffer(out);
  } catch (error) {
    if (error instanceof PdfPasswordError) {
      throw new Error('PDF sudah terenkripsi. Hapus proteksi dulu sebelum memberi password baru.');
    }
    throw error;
  }
}

/** Referensi halaman pada salah satu dokumen input (0-based). */
export interface PageRef {
  file: number;
  page: number;
}

/** Opsi penempelan gambar (tanda tangan / stempel) ke halaman tertentu. */
export interface StampOptions {
  imageBytes: ArrayBuffer;
  imageType: 'png' | 'jpg';
  /** Indeks halaman 0-based yang menerima gambar; indeks di luar rentang dilewati. */
  pages: number[];
  /** Posisi pojok kiri-atas gambar, dalam persen lebar/tinggi halaman. */
  xPct: number;
  yPct: number;
  /** Lebar gambar dalam persen lebar halaman; tinggi mengikuti rasio aspek. */
  widthPct: number;
  /** 0-1. */
  opacity: number;
}

/** Tempel gambar (tanda tangan / stempel) pada halaman terpilih — jalankan di main thread seperti pdf-to-image. */
export async function stampImage(input: ArrayBuffer, opts: StampOptions): Promise<ArrayBuffer> {
  const doc = await PDFDocument.load(input);
  const pages = doc.getPages();
  const targets = opts.pages.map((index) => pages[index]).filter((page): page is PDFPage => Boolean(page));
  if (!targets.length) throw new Error('Tidak ada halaman valid untuk ditempeli gambar.');
  const image = opts.imageType === 'png' ? await doc.embedPng(opts.imageBytes) : await doc.embedJpg(opts.imageBytes);
  for (const page of targets) {
    const { width, height } = page.getSize();
    const w = (opts.widthPct / 100) * width;
    const h = w * (image.height / image.width);
    const x = (opts.xPct / 100) * width;
    const y = height - (opts.yPct / 100) * height - h;
    page.drawImage(image, { x, y, width: w, height: h, opacity: opts.opacity });
  }
  return (await doc.save()).buffer as ArrayBuffer;
}

/** Satu field AcroForm yang tampil di UI. */
export interface FormFieldInfo {
  name: string;
  type: 'text' | 'checkbox' | 'dropdown' | 'radio' | 'optionlist';
  value: string;
  /** Pilihan yang tersedia (dropdown/radio/optionlist). */
  options?: string[];
}

/** Baca semua field AcroForm yang bisa diisi — jalankan di main thread. */
export async function listFormFields(input: ArrayBuffer): Promise<FormFieldInfo[]> {
  const doc = await PDFDocument.load(input);
  if (!doc.getForm) return [];
  const form = doc.getForm();
  return form.getFields().flatMap((field): FormFieldInfo[] => {
    const name = field.getName();
    if (field instanceof PDFTextField) return [{ name, type: 'text' as const, value: field.getText() ?? '' }];
    if (field instanceof PDFCheckBox) return [{ name, type: 'checkbox' as const, value: field.isChecked() ? 'ya' : 'tidak' }];
    if (field instanceof PDFDropdown) return [{ name, type: 'dropdown' as const, value: field.getSelected()[0] ?? '', options: field.getOptions() }];
    if (field instanceof PDFRadioGroup) return [{ name, type: 'radio' as const, value: field.getSelected() ?? '', options: field.getOptions() }];
    if (field instanceof PDFOptionList) return [{ name, type: 'optionlist' as const, value: field.getSelected()[0] ?? '', options: field.getOptions() }];
    return [];
  });
}

export interface FormFillValues {
  /** Nama field → nilai (teks) atau indeks pilihan (dropdown/radio/optionlist) atau boolean (checkbox). */
  values: Record<string, string | number | boolean>;
}

/** Isi field AcroForm sesuai nilai yang diberikan — jalankan di main thread. */
export async function fillForm(input: ArrayBuffer, values: Record<string, string | number | boolean>): Promise<ArrayBuffer> {
  const doc = await PDFDocument.load(input);
  const form = doc.getForm();
  for (const [name, value] of Object.entries(values)) {
    let field;
    try {
      field = form.getField(name);
    } catch {
      continue;
    }
    if (field instanceof PDFTextField && typeof value === 'string') field.setText(value);
    else if (field instanceof PDFCheckBox) value ? field.check() : field.uncheck();
    else if ((field instanceof PDFDropdown || field instanceof PDFRadioGroup || field instanceof PDFOptionList) && (typeof value === 'number' || typeof value === 'string')) {
      const options = field.getOptions();
      const selection = typeof value === 'number' ? options[value] : value;
      if (selection !== undefined) field.select(selection);
    }
  }
  form.updateFieldAppearances();
  return (await doc.save()).buffer as ArrayBuffer;
}

/** Ratakan semua form/annotation menjadi konten statis — pakai qpdf WASM (pdfstudio). */
export async function flattenForm(input: ArrayBuffer): Promise<ArrayBuffer> {
  const toolkit = await getUnlockToolkit();
  const out = await toolkit.flatten(input, { annotations: 'all' });
  return toArrayBuffer(out);
}

const UNSAFE_ACTIONS = new Set(['JavaScript', 'Launch', 'SubmitForm', 'ImportData']);

/**
 * Buang data tersembunyi: info dokumen, XMP, data privat aplikasi (PieceInfo), lampiran,
 * JavaScript, dan aksi otomatis. Isi halaman, tautan, formulir, dan bookmark tetap.
 */
export async function sanitizePdf(input: ArrayBuffer): Promise<ArrayBuffer> {
  const doc = await PDFDocument.load(input, { updateMetadata: false });
  const { context, catalog } = doc;
  context.trailerInfo.Info = undefined;
  catalog.delete(PDFName.of('OpenAction'));
  const names = catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  names?.delete(PDFName.of('JavaScript'));
  names?.delete(PDFName.of('EmbeddedFiles'));

  const isUnsafeAction = (v: PDFObject | undefined): boolean => {
    const d = v instanceof PDFRef ? context.lookup(v) : v;
    if (d instanceof PDFArray) return d.asArray().some(isUnsafeAction);
    return d instanceof PDFDict && UNSAFE_ACTIONS.has(d.lookupMaybe(PDFName.of('S'), PDFName)?.decodeText() ?? '');
  };
  // Telusuri setiap objek beserta dict/array langsung di dalamnya (aksi sering ditulis inline).
  const walk = (obj: PDFObject): void => {
    if (obj instanceof PDFStream) return walk(obj.dict);
    if (obj instanceof PDFArray) return obj.asArray().forEach(walk);
    if (!(obj instanceof PDFDict)) return;
    for (const key of ['AA', 'Metadata', 'PieceInfo', 'AF']) obj.delete(PDFName.of(key));
    for (const key of ['A', 'Next']) if (isUnsafeAction(obj.get(PDFName.of(key)))) obj.delete(PDFName.of(key));
    obj.entries().forEach(([, v]) => walk(v));
  };
  context.enumerateIndirectObjects().forEach(([, obj]) => walk(obj));

  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    for (let i = (annots?.size() ?? 0) - 1; i >= 0; i--) {
      if (annots!.lookupMaybe(i, PDFDict)?.get(PDFName.of('Subtype')) === PDFName.of('FileAttachment')) annots!.remove(i);
    }
  }

  return rewriteReachable(await doc.save());
}

/**
 * pdf-lib tetap menulis objek yatim (yang referensinya sudah dilepas). qpdf hanya menulis objek
 * yang masih terjangkau, jadi sisa itu — dan revisi lama — ikut terbuang. Hanya jalan di worker:
 * CSP halaman memblokir kompilasi WASM.
 */
export async function rewriteReachable(bytes: Uint8Array): Promise<ArrayBuffer> {
  const toolkit = await getUnlockToolkit();
  return toArrayBuffer(await toolkit.raw([bytes], ['$in0', '--object-streams=generate', '$out']));
}

export type NupLayout = '2' | '4' | 'booklet';

/** Urutan halaman buklet per sisi lembar (kiri, kanan); -1 = halaman kosong pengisi kelipatan 4. */
export function bookletOrder(count: number): number[] {
  const n = Math.ceil(count / 4) * 4;
  const order: number[] = [];
  for (let k = 0; k < n / 2; k++) {
    const pair = k % 2 === 0 ? [n - 1 - k, k] : [k, n - 1 - k];
    order.push(...pair.map((i) => (i < count ? i : -1)));
  }
  return order;
}

/** Ukuran halaman seperti tampil di viewer: CropBox, ditukar bila /Rotate 90/270. */
function displaySize(page: PDFPage, rotation: number): [number, number] {
  const { width, height } = page.getCropBox();
  return rotation % 180 ? [height, width] : [width, height];
}

/**
 * Susun 2 atau 4 halaman per lembar, atau buklet (2 per sisi, urutan lipat tengah).
 * Ukuran lembar mengikuti halaman pertama; 2-up dan buklet memakai orientasi kebalikannya.
 */
export async function nUpPdf(input: ArrayBuffer, layout: NupLayout): Promise<ArrayBuffer> {
  const src = await PDFDocument.load(input);
  const pages = src.getPages();
  const out = await PDFDocument.create();
  // Embed sebatas CropBox — tanpa ini halaman yang sudah dipotong muncul utuh lagi.
  // Halaman tanpa /Contents (kosong) tidak bisa di-embed pdf-lib; biarkan selnya kosong.
  const embedded = await Promise.all(pages.map((p) => {
    const b = p.getCropBox();
    return p.node.Contents() ? out.embedPage(p, { left: b.x, bottom: b.y, right: b.x + b.width, top: b.y + b.height }) : undefined;
  }));
  const rotations = pages.map((p) => ((p.getRotation().angle % 360) + 360) % 360);
  const [w, h] = displaySize(pages[0], rotations[0]);
  const [sheetW, sheetH] = layout === '4' ? [w, h] : [h, w];
  // 2-up dari halaman landscape (mis. slide) → lembar portrait, halaman ditumpuk atas-bawah.
  const cols = layout === '2' && sheetW < sheetH ? 1 : 2;
  const rows = layout === '4' || cols === 1 ? 2 : 1;
  const cellW = sheetW / cols;
  const cellH = sheetH / rows;
  const order = layout === 'booklet' ? bookletOrder(pages.length) : pages.map((_, i) => i);

  for (let s = 0; s < order.length; s += cols * rows) {
    const sheet = out.addPage([sheetW, sheetH]);
    order.slice(s, s + cols * rows).forEach((idx, slot) => {
      const page = embedded[idx];
      if (!page) return;
      const rot = rotations[idx];
      const [pw, ph] = displaySize(pages[idx], rot);
      const scale = Math.min(cellW / pw, cellH / ph);
      const px = (slot % cols) * cellW + (cellW - pw * scale) / 2;
      const py = sheetH - (Math.floor(slot / cols) + 1) * cellH + (cellH - ph * scale) / 2;
      // drawPage memutar di titik (x, y): geser titik itu ke sudut yang tepat agar hasil putaran
      // (searah jarum jam seperti /Rotate) tetap mengisi kotak px..px+lebar, py..py+tinggi.
      sheet.drawPage(page, {
        x: rot === 180 || rot === 270 ? px + pw * scale : px,
        y: rot === 90 || rot === 180 ? py + ph * scale : py,
        xScale: scale,
        yScale: scale,
        rotate: degrees(-rot),
      });
    });
  }
  return (await out.save({ useObjectStreams: true })).buffer as ArrayBuffer;
}

/** Kata hasil OCR dalam koordinat PDF halaman: titik awal baseline, lebar & ukuran dalam poin. */
export interface TextLayerWord { text: string; x: number; y: number; size: number; width: number; rotation: number }

/** Tambahkan lapisan teks tak terlihat (render mode 3) agar PDF hasil scan bisa dicari dan disalin. */
export async function addTextLayer(input: ArrayBuffer, pages: TextLayerWord[][]): Promise<ArrayBuffer> {
  const doc = await PDFDocument.load(input);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const charset = new Set(font.getCharacterSet());
  doc.getPages().forEach((page, i) => {
    const words = pages[i];
    if (!words?.length) return;
    // Konten lama yang meninggalkan CTM tanpa Q sudah dibungkus q…Q oleh pdf-lib (autoNormalizeCTM).
    const fontKey = page.node.newFontDictionary(font.name, font.ref);
    const ops = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
    for (const w of words) {
      // Helvetica standar hanya WinAnsi; karakter di luarnya diganti agar encode tidak gagal.
      const text = [...w.text].map((c) => (charset.has(c.codePointAt(0)!) ? c : '?')).join('');
      const natural = font.widthOfTextAtSize(text, w.size);
      if (!natural) continue;
      ops.push(
        setFontAndSize(fontKey, w.size),
        // Tz meregangkan kata selebar bbox-nya, sehingga sorotan saat mencari/memilih pas dengan gambar.
        setCharacterSqueeze((w.width / natural) * 100),
        rotateAndSkewTextDegreesAndTranslate(w.rotation, 0, 0, w.x, w.y),
        showText(font.encodeText(`${text} `)),
      );
    }
    ops.push(endText(), popGraphicsState());
    page.pushOperators(...ops);
  });
  return (await doc.save()).buffer as ArrayBuffer;
}

/**
 * Gabungkan halaman tertentu dari beberapa dokumen sesuai urutan yang diberikan.
 * Memungkinkan reorder lintas-dokumen dan penghapusan halaman.
 */
export async function mergePages(inputs: ArrayBuffer[], refs: PageRef[]): Promise<ArrayBuffer> {
  if (!inputs.length) throw new Error('Tidak ada dokumen untuk digabungkan.');
  if (!refs.length) throw new Error('Tidak ada halaman yang dipilih untuk digabungkan.');
  const out = await PDFDocument.create();
  const cache = new Map<number, PDFDocument>();
  for (const ref of refs) {
    if (ref.file < 0 || ref.file >= inputs.length) throw new Error(`Dokumen ke-${ref.file + 1} tidak tersedia.`);
    let doc = cache.get(ref.file);
    if (!doc) { doc = await PDFDocument.load(inputs[ref.file]); cache.set(ref.file, doc); }
    const count = doc.getPageCount();
    if (ref.page < 0 || ref.page >= count) throw new Error(`Halaman ${ref.page + 1} tidak ada pada dokumen ${ref.file + 1}.`);
    const [copied] = await out.copyPages(doc, [ref.page]);
    out.addPage(copied);
  }
  return savePagesOnly(out);
}

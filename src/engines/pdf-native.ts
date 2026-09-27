import { PDFDocument, degrees, StandardFonts, rgb, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { createPdfToolkit, PdfPasswordError, type PdfToolkit } from 'pdfstudio';

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
  for (const index of valid) {
    const next = await PDFDocument.create();
    const [page] = await next.copyPages(doc, [index]);
    next.addPage(page);
    outputs.push((await next.save()).buffer as ArrayBuffer);
  }
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
    const next = await PDFDocument.create();
    const pages = await next.copyPages(doc, indices);
    pages.forEach((p) => next.addPage(p));
    outputs.push((await next.save()).buffer as ArrayBuffer);
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
    const next = await PDFDocument.create();
    const pages = await next.copyPages(doc, group);
    pages.forEach((p) => next.addPage(p));
    outputs.push((await next.save()).buffer as ArrayBuffer);
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

/** Hapus halaman berdasarkan index 0-based. */
export async function deletePages(input: ArrayBuffer, indices: number[]): Promise<ArrayBuffer> {
  const doc = await PDFDocument.load(input);
  const pageCount = doc.getPageCount();
  const toDelete = new Set(indices.filter((i) => i >= 0 && i < pageCount));
  const keep = Array.from({ length: pageCount }, (_, i) => i).filter((i) => !toDelete.has(i));
  if (!keep.length) throw new Error('Tidak dapat menghapus semua halaman dari dokumen.');
  const out = await PDFDocument.create();
  const pages = await out.copyPages(doc, keep);
  pages.forEach((p) => out.addPage(p));
  return (await out.save()).buffer as ArrayBuffer;
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

/** Jenis tanda air. */
export type WatermarkType = 'center' | 'tiled' | 'positioned' | 'image';
export type WatermarkPosition = 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** Opsi tanda air. */
export interface WatermarkOptions {
  text: string;
  fontSize?: number;
  opacity?: number;
  rotation?: number;
  color?: string;
  font?: string;
  type?: WatermarkType;
  position?: WatermarkPosition;
  tileGap?: number;
  imageBytes?: ArrayBuffer;
  imageType?: 'png' | 'jpg';
  imageScale?: number;
  /** Jarak antar karakter (pt). 0 = normal. */
  letterSpacing?: number;
  /** Pengali tinggi baris terhadap ukuran font (multi-baris, teks dipisah \n). Default 1.2. */
  lineHeight?: number;
  /** Geser horizontal dari posisi terhitung (pt). */
  offsetX?: number;
  /** Geser vertikal dari posisi terhitung (pt). */
  offsetY?: number;
  /** Bytes font TTF/OTF yang diunggah user — menimpa pilihan `font`. */
  customFontBytes?: ArrayBuffer;
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

  // Image watermark
  if (type === 'image' && opts.imageBytes) {
    const imageType = opts.imageType ?? 'png';
    const image = imageType === 'png' ? await doc.embedPng(opts.imageBytes) : await doc.embedJpg(opts.imageBytes);
    const imageScale = opts.imageScale ?? 0.3;
    pages.forEach((page) => {
      const { width, height } = page.getSize();
      const w = width * imageScale;
      const h = (image.height / image.width) * w;
      page.drawImage(image, {
        x: (width - w) / 2,
        y: (height - h) / 2,
        width: w,
        height: h,
        opacity,
      });
    });
    return (await doc.save()).buffer as ArrayBuffer;
  }

  // Text-based watermark
  if (!opts.text?.trim()) throw new Error('Teks tanda air tidak boleh kosong.');
  // Spasi huruf bisa negatif (merapatkan); dibatasi agar karakter tidak bertumpuk terbalik
  const spacing = Math.max(-(opts.fontSize ?? 50) * 0.5, opts.letterSpacing ?? 0);
  const lineHeight = opts.lineHeight ?? 1.2;
  const offX = opts.offsetX ?? 0;
  const offY = opts.offsetY ?? 0;

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
  const position = opts.position ?? 'center';
  const tileGap = opts.tileGap ?? size * 2.5;
  const drawOpts: DrawBlockOpts = { font, size, color: rgb(c.r, c.g, c.b), opacity, rotation, spacing, lineHeight };

  pages.forEach((page) => {
    const { width, height } = page.getSize();
    const lines = opts.text.split('\n');
    const widest = Math.max(...lines.map((l) => spacedLineWidth(font, l, size, spacing)));
    const blockH = (lines.length - 1) * lineHeight * size;

    if (type === 'tiled') {
      const stepX = widest + tileGap;
      const stepY = blockH + size + tileGap;
      for (let y = stepY / 2; y < height + stepY; y += stepY) {
        for (let x = -stepX; x < width + stepX; x += stepX) {
          const rowOffset = (Math.floor(y / stepY) % 2) * (stepX / 2);
          drawTextBlockCentered(page, opts.text, x + rowOffset + widest / 2 + offX, y + offY, drawOpts);
        }
      }
    } else if (type === 'positioned') {
      const margin = 40;
      let bx: number, by: number; // pusat blok
      switch (position) {
        case 'top-left': bx = margin + widest / 2; by = height - margin - blockH / 2; break;
        case 'top-right': bx = width - margin - widest / 2; by = height - margin - blockH / 2; break;
        case 'bottom-left': bx = margin + widest / 2; by = margin + blockH / 2; break;
        case 'bottom-right': bx = width - margin - widest / 2; by = margin + blockH / 2; break;
        default: bx = width / 2; by = height / 2;
      }
      drawTextBlockCentered(page, opts.text, bx + offX, by + offY, { ...drawOpts, rotation: position === 'center' ? rotation : 0 });
    } else {
      // center (default) — berotasi mengelilingi pusat halaman, sama seperti preview
      drawTextBlockCentered(page, opts.text, width / 2 + offX, height / 2 + offY, drawOpts);
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
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteLength) as ArrayBuffer;
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
  return (await out.save()).buffer as ArrayBuffer;
}

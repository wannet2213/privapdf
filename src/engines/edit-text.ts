import {
  PDFDocument, PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, StandardFonts, TextRenderingMode,
  decodePDFRawStream, rgb, cmyk, grayscale, pushGraphicsState, popGraphicsState, beginText, endText,
  setFontAndSize, setTextRenderingMode, setLineHeight, setLineWidth, setFillingColor, setStrokingColor,
  rotateAndSkewTextDegreesAndTranslate, showText, nextLine, type PDFFont, type PDFObject, type PDFPage, type Color,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { parseOps, spliceOps, type Op } from '../lib/content-stream';
import { rewriteReachable, prunePageResources, dictAt, arrayAt } from './pdf-native';

export interface TextEdit {
  page: number;
  /** Area baris asli (koordinat PDF: x0, y0, x1, y1). Teks asli yang mulai di dalamnya dihapus; tanpa rect = teks baru. */
  rect?: [number, number, number, number];
  text: string;
  /** Titik awal baseline, ukuran, dan sudut (derajat) — untuk teks baru, atau bila teks asli tidak ditemukan. */
  x: number;
  y: number;
  size: number;
  rotation: number;
}

type Matrix = [number, number, number, number, number, number];
// Konvensi PDF (vektor baris): titik × M; mul(a, b) = a lalu b.
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

interface FontStyle { bold: boolean; italic: boolean; serif: boolean; mono: boolean }

interface FontInfo {
  twoByte: boolean;
  /** Lebar glyph dalam satuan teks (skala FontMatrix sudah diterapkan). */
  width: (code: number) => number;
  baseFont: string;
  style: FontStyle;
  /** TrueType/OpenType ter-embed — dipakai ulang untuk teks baru bila glyph-nya lengkap. */
  file?: Uint8Array;
}

interface Shown {
  op: Op;
  x: number;
  y: number;
  /** Arah baseline (derajat) dan ukuran efektif di ruang halaman. */
  angle: number;
  size: number;
  font: FontInfo;
  color: Color;
  /** Bold sintetis: banyak PDF menebalkan font biasa dengan render mode stroke (Tr 1/2). */
  renderMode: number;
  strokeColor: Color;
  lineWidth: number;
  /** Pengganti op ini yang tidak menggambar apa pun tapi memajukan posisi teks sama persis. */
  blank: string;
}

const num = (o: PDFObject | undefined) => (o instanceof PDFNumber ? o.asNumber() : undefined);
const nameOf = (o: PDFObject | undefined) => (o instanceof PDFName ? o.decodeText() : undefined);

function fontFile(descriptor: PDFDict | undefined): Uint8Array | undefined {
  for (const key of ['FontFile2', 'FontFile3']) {
    const stream = descriptor?.lookup(PDFName.of(key));
    if (!(stream instanceof PDFRawStream)) continue;
    // FontFile3 berisi CFF polos kecuali bersubtipe OpenType — fontkit/pdf-lib hanya bisa memakai OpenType.
    if (key === 'FontFile3' && nameOf(stream.dict.lookup(PDFName.of('Subtype'))) !== 'OpenType') continue;
    try { return decodePDFRawStream(stream).decode(); } catch { return undefined; }
  }
  return undefined;
}

/**
 * Gaya font dari nama dan FontDescriptor. Nama saja tidak cukup: banyak PDF menamai font
 * bebas ("F1", "Font3") dan menyatakan tebal lewat /FontWeight atau flag ForceBold.
 */
function fontStyle(baseFont: string, descriptor: PDFDict | undefined): FontStyle {
  const s = baseFont.toLowerCase();
  const flags = num(descriptor?.lookup(PDFName.of('Flags'))) ?? 0;
  const weight = num(descriptor?.lookup(PDFName.of('FontWeight'))) ?? 0;
  const italicAngle = num(descriptor?.lookup(PDFName.of('ItalicAngle'))) ?? 0;
  return {
    bold: /bold|black|heavy|semib|demi|[-_,]bd\b/.test(s) || weight >= 600 || (flags & 0x40000) !== 0,
    italic: /italic|oblique|[-_,]it\b/.test(s) || (flags & 0x40) !== 0 || italicAngle !== 0,
    mono: /mono|courier|consol|menlo/.test(s) || (flags & 0x1) !== 0,
    serif: (/times|roman|serif|georgia|garamond|cambria|book|minion|palatino/.test(s) && !/sans/.test(s)) || ((flags & 0x2) !== 0 && !/sans|arial|helvet|calibri|verdana/.test(s)),
  };
}

function fontInfo(font: PDFDict | undefined): FontInfo {
  // ponytail: font standar-14 tanpa /Widths memakai lebar rata-rata 0,5 em. Hanya memengaruhi
  // posisi op lanjutan tanpa Td di baris yang sama; tambahkan metrik AFM bila itu jadi masalah.
  const fallback: FontInfo = { twoByte: false, width: () => 0.5, baseFont: '', style: fontStyle('', undefined) };
  if (!font) return fallback;
  try {
    const baseFont = (nameOf(font.lookup(PDFName.of('BaseFont'))) ?? '').replace(/^[A-Z]{6}\+/, '');
    if (nameOf(font.lookup(PDFName.of('Subtype'))) === 'Type0') {
      const desc = font.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray)?.lookupMaybe(0, PDFDict);
      const dw = num(desc?.lookup(PDFName.of('DW'))) ?? 1000;
      const widths = new Map<number, number>();
      const w = desc?.lookupMaybe(PDFName.of('W'), PDFArray);
      // W: c [w1 w2 …]  atau  c_awal c_akhir w
      for (let i = 0; w && i < w.size();) {
        const first = num(w.lookup(i));
        const next = w.lookup(i + 1);
        if (first === undefined) break;
        if (next instanceof PDFArray) {
          next.asArray().forEach((_, j) => widths.set(first + j, num(next.lookup(j)) ?? dw));
          i += 2;
        } else {
          const last = num(next);
          const width = num(w.lookup(i + 2));
          if (last === undefined || width === undefined) break;
          for (let c = first; c <= last; c++) widths.set(c, width);
          i += 3;
        }
      }
      // ponytail: kode 2 byte (Identity-H/V, encoding CID paling umum); CMap berpanjang-kode campuran tidak didukung.
      const descriptor = desc?.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
      return { twoByte: true, width: (cid) => (widths.get(cid) ?? dw) / 1000, baseFont, style: fontStyle(baseFont, descriptor), file: fontFile(descriptor) };
    }
    const first = num(font.lookup(PDFName.of('FirstChar'))) ?? 0;
    const widths = font.lookupMaybe(PDFName.of('Widths'), PDFArray);
    const descriptor = font.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
    const missing = num(descriptor?.lookup(PDFName.of('MissingWidth')));
    const matrix = font.lookupMaybe(PDFName.of('FontMatrix'), PDFArray);
    const scale = (matrix && num(matrix.lookup(0))) ?? 0.001;
    return {
      twoByte: false,
      width: (code) => {
        const v = widths && code >= first && code - first < widths.size() ? num(widths.lookup(code - first)) : undefined;
        return v !== undefined ? v * scale : missing !== undefined ? missing * scale : 0.5;
      },
      baseFont,
      style: fontStyle(baseFont, descriptor),
      file: fontFile(descriptor),
    };
  } catch {
    return fallback;
  }
}

function contentBytes(page: PDFPage): Uint8Array {
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => page.doc.context.lookup(r)) : [contents];
  const parts = streams.filter((s): s is PDFRawStream => s instanceof PDFRawStream).map((s) => decodePDFRawStream(s).decode());
  // Antar-stream dipisah spasi: token tidak boleh menyambung lintas batas stream.
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length + 1, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; out[offset++] = 10; }
  return out;
}

const fmt = (n: number) => (Math.abs(n) < 1e-6 ? '0' : n.toFixed(4).replace(/\.?0+$/, ''));

/** Telusuri operator teks halaman dan catat posisi tiap operasi penampil teks. */
function interpret(ops: Op[], fonts: PDFDict | undefined): Shown[] {
  type State = { ctm: Matrix; font: FontInfo; size: number; tc: number; tw: number; th: number; tl: number; ts: number; tr: number; color: Color; stroke: Color; lw: number };
  const fontCache = new Map<string, FontInfo>();
  const getFont = (name: string) => {
    if (!fontCache.has(name)) fontCache.set(name, fontInfo(fonts?.lookupMaybe(PDFName.of(name), PDFDict)));
    return fontCache.get(name)!;
  };
  let st: State = { ctm: IDENTITY, font: fontInfo(undefined), size: 0, tc: 0, tw: 0, th: 1, tl: 0, ts: 0, tr: 0, color: grayscale(0), stroke: grayscale(0), lw: 1 };
  const stack: State[] = [];
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  const shown: Shown[] = [];
  const n = (op: Op, i: number) => (typeof op.operands[i] === 'number' ? (op.operands[i] as number) : 0);
  const nextLine = (tx: number, ty: number) => { tlm = mul([1, 0, 0, 1, tx, ty], tlm); tm = tlm; };

  const show = (op: Op, items: (Uint8Array | number)[], prefix: string) => {
    const m = mul(tm, st.ctm);
    const trm = mul([st.size * st.th, 0, 0, st.size, 0, st.ts], m);
    let adv = 0;
    for (const item of items) {
      if (typeof item === 'number') { adv += (-item / 1000) * st.size * st.th; continue; }
      const step = st.font.twoByte ? 2 : 1;
      for (let i = 0; i + step <= item.length; i += step) {
        const code = step === 2 ? item[i] * 256 + item[i + 1] : item[i];
        adv += (st.font.width(code) * st.size + st.tc + (step === 1 && code === 32 ? st.tw : 0)) * st.th;
      }
    }
    const scale = st.size * st.th;
    shown.push({
      op, x: trm[4], y: trm[5],
      angle: (Math.atan2(m[1], m[0]) * 180) / Math.PI,
      size: st.size * Math.hypot(m[2], m[3]),
      font: st.font, color: st.color,
      renderMode: st.tr, strokeColor: st.stroke,
      // Tebal garis ikut skala CTM saat teks digambar; teks baru digambar di ruang halaman.
      lineWidth: st.lw * Math.sqrt(Math.abs(st.ctm[0] * st.ctm[3] - st.ctm[1] * st.ctm[2])),
      blank: prefix + (scale ? `[${fmt((-adv * 1000) / scale)}] TJ` : ''),
    });
    tm = mul([1, 0, 0, 1, adv, 0], tm);
  };

  for (const op of ops) {
    const o = op.operands;
    switch (op.operator) {
      case 'q': stack.push({ ...st }); break;
      case 'Q': st = stack.pop() ?? st; break;
      case 'cm': st.ctm = mul([n(op, 0), n(op, 1), n(op, 2), n(op, 3), n(op, 4), n(op, 5)], st.ctm); break;
      case 'BT': tm = tlm = IDENTITY; break;
      case 'Tf': st.font = getFont(String(o[0])); st.size = n(op, 1); break;
      case 'Tc': st.tc = n(op, 0); break;
      case 'Tw': st.tw = n(op, 0); break;
      case 'Tz': st.th = n(op, 0) / 100; break;
      case 'TL': st.tl = n(op, 0); break;
      case 'Ts': st.ts = n(op, 0); break;
      case 'Tr': st.tr = n(op, 0); break;
      case 'w': st.lw = n(op, 0); break;
      case 'Td': nextLine(n(op, 0), n(op, 1)); break;
      case 'TD': st.tl = -n(op, 1); nextLine(n(op, 0), n(op, 1)); break;
      case 'Tm': tm = tlm = [n(op, 0), n(op, 1), n(op, 2), n(op, 3), n(op, 4), n(op, 5)]; break;
      case 'T*': nextLine(0, -st.tl); break;
      case 'Tj': if (o[0] instanceof Uint8Array) show(op, [o[0]], ''); break;
      case 'TJ': if (Array.isArray(o[0])) show(op, o[0].filter((v): v is Uint8Array | number => v instanceof Uint8Array || typeof v === 'number'), ''); break;
      case "'": nextLine(0, -st.tl); if (o[0] instanceof Uint8Array) show(op, [o[0]], 'T* '); break;
      case '"':
        st.tw = n(op, 0); st.tc = n(op, 1); nextLine(0, -st.tl);
        if (o[2] instanceof Uint8Array) show(op, [o[2]], `${fmt(st.tw)} Tw ${fmt(st.tc)} Tc T* `);
        break;
      case 'g': st.color = grayscale(n(op, 0)); break;
      case 'rg': st.color = rgb(n(op, 0), n(op, 1), n(op, 2)); break;
      case 'k': st.color = cmyk(n(op, 0), n(op, 1), n(op, 2), n(op, 3)); break;
      case 'G': st.stroke = grayscale(n(op, 0)); break;
      case 'RG': st.stroke = rgb(n(op, 0), n(op, 1), n(op, 2)); break;
      case 'K': st.stroke = cmyk(n(op, 0), n(op, 1), n(op, 2), n(op, 3)); break;
      case 'sc': case 'scn': st.color = numericColor(o) ?? st.color; break;
      case 'SC': case 'SCN': st.stroke = numericColor(o) ?? st.stroke; break;
    }
  }
  return shown;
}

/** Warna dari operand sc/scn numerik (1 = abu, 3 = RGB, 4 = CMYK); pola/nama ruang warna diabaikan. */
function numericColor(o: unknown[]): Color | undefined {
  if (!o.every((v) => typeof v === 'number')) return undefined;
  const v = o as number[];
  return v.length === 1 ? grayscale(v[0]) : v.length === 3 ? rgb(v[0], v[1], v[2]) : v.length === 4 ? cmyk(v[0], v[1], v[2], v[3]) : undefined;
}

function standardFor({ bold, italic, serif, mono }: FontStyle) {
  if (mono) return bold ? (italic ? StandardFonts.CourierBoldOblique : StandardFonts.CourierBold) : italic ? StandardFonts.CourierOblique : StandardFonts.Courier;
  if (serif) return bold ? (italic ? StandardFonts.TimesRomanBoldItalic : StandardFonts.TimesRomanBold) : italic ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman;
  return bold ? (italic ? StandardFonts.HelveticaBoldOblique : StandardFonts.HelveticaBold) : italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica;
}

/** Font ter-embed hanya dipakai ulang bila subset-nya memuat semua glyph teks baru. */
function covers(file: Uint8Array, text: string): boolean {
  try {
    const font = fontkit.create(file);
    return [...text.replace(/\s/g, '')].every((ch) => font.glyphsForString(ch).some((g) => g.id !== 0));
  } catch {
    return false;
  }
}

const OCR_ONLY = 'Baris ini teks OCR tak terlihat di atas gambar scan: gambarnya tidak bisa diedit, jadi nilai lama tetap terlihat. Untuk menutup data di scan, pakai Sensor PDF.';
// Pembawa teks pengganti yang tetap memuat teks lama setelah glyph-nya dihapus.
const ALT_TEXT_KEYS = ['ActualText', 'Alt', 'E'];

/** Nilai number tree (mis. ParentTree) untuk `key`; telusur penuh, tanpa memakai /Limits. */
function numberTreeGet(doc: PDFDocument, node: PDFDict | undefined, key: number, depth = 0): PDFObject | undefined {
  if (!node || depth > 32) return undefined;
  const nums = arrayAt(doc.context, node.get(PDFName.of('Nums'))) ?? [];
  for (let i = 0; i + 1 < nums.length; i += 2) if (num(doc.context.lookup(nums[i])) === key) return nums[i + 1];
  for (const kid of arrayAt(doc.context, node.get(PDFName.of('Kids'))) ?? []) {
    const found = numberTreeGet(doc, dictAt(doc.context, kid), key, depth + 1);
    if (found) return found;
  }
  return undefined;
}

/**
 * Marked content yang membungkus op terhapus: /ActualText, /Alt, /E-nya (inline atau lewat
 * /Properties bernama) dan StructElem pemilik MCID-nya masih memuat teks lama — dibaca pdf.js,
 * pembaca layar, dan salin-tempel. Op BDC ditulis ulang tanpa pembawa itu (dict /Properties
 * bersama tidak diubah; entri yang tak lagi dipanggil hilang saat Resources dipangkas).
 */
function stripMarkedContent(doc: PDFDocument, page: PDFPage, ops: Op[], removed: Map<Op, string>) {
  const ctx = doc.context;
  const props = dictAt(ctx, page.node.Resources()?.get(PDFName.of('Properties')));
  const wrapping = new Set<Op>();
  const stack: Op[] = [];
  for (const op of ops) {
    if (op.operator === 'BDC' || op.operator === 'BMC') stack.push(op);
    else if (op.operator === 'EMC') stack.pop();
    else if (removed.has(op)) stack.forEach((m) => wrapping.add(m));
  }
  const mcids: number[] = [];
  for (const op of wrapping) {
    if (op.operator !== 'BDC') continue;
    const [tag, list] = op.operands;
    const named = typeof list === 'string' ? dictAt(ctx, props?.get(PDFName.of(list))) : undefined;
    const inline = list && typeof list === 'object' && !(list instanceof Uint8Array) && !Array.isArray(list) ? list : undefined;
    const mcid = named ? num(ctx.lookup(named.get(PDFName.of('MCID')))) : typeof inline?.MCID === 'number' ? inline.MCID : undefined;
    if (mcid !== undefined) mcids.push(mcid);
    const carries = ALT_TEXT_KEYS.some((k) => (named ? named.has(PDFName.of(k)) : inline !== undefined && k in inline));
    if (carries && typeof tag === 'string') removed.set(op, mcid !== undefined ? `${PDFName.of(tag)} <</MCID ${mcid}>> BDC` : `${PDFName.of(tag)} BMC`);
  }

  const structParents = num(ctx.lookup(page.node.get(PDFName.of('StructParents'))));
  const root = dictAt(ctx, doc.catalog.get(PDFName.of('StructTreeRoot')));
  const owners = structParents === undefined ? undefined : arrayAt(ctx, numberTreeGet(doc, dictAt(ctx, root?.get(PDFName.of('ParentTree'))), structParents));
  for (const mcid of mcids) {
    const elem = dictAt(ctx, owners?.[mcid]);
    for (const k of ALT_TEXT_KEYS) elem?.delete(PDFName.of(k));
  }
}

/**
 * Ganti/tambah teks. Operasi teks asli yang mulai di dalam area baris dibuang dari content stream
 * (diganti TJ kosong selebar aslinya agar teks lain tidak bergeser), lalu teks baru digambar dengan
 * font, ukuran, warna, dan sudut aslinya. Hasil ditulis ulang qpdf agar stream lama tidak tersisa.
 */
export async function editText(input: ArrayBuffer, edits: TextEdit[]): Promise<ArrayBuffer> {
  const doc = await PDFDocument.load(input);
  doc.registerFontkit(fontkit);
  const pages = doc.getPages();
  const fontCache = new Map<string, PDFFont>();
  const embed = async (info: FontInfo | undefined, text: string): Promise<PDFFont> => {
    if (info?.file && covers(info.file, text)) {
      const key = `file:${info.baseFont}:${info.file.length}`;
      if (!fontCache.has(key)) {
        try { fontCache.set(key, await doc.embedFont(info.file, { subset: true })); } catch { /* subset rusak → font standar */ }
      }
      if (fontCache.has(key)) return fontCache.get(key)!;
    }
    const std = standardFor(info?.style ?? fontStyle('', undefined));
    if (!fontCache.has(std)) fontCache.set(std, await doc.embedFont(std));
    return fontCache.get(std)!;
  };

  const byPage = new Map<number, TextEdit[]>();
  for (const e of edits) byPage.set(e.page, [...(byPage.get(e.page) ?? []), e]);
  for (const [pageIndex, pageEdits] of byPage) {
    const page = pages[pageIndex];
    if (!page) continue;
    const bytes = contentBytes(page);
    const ops = parseOps(bytes);
    const shown = interpret(ops, page.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict));
    const removed = new Map<Op, string>();
    const anchors = pageEdits.map((edit) => {
      if (!edit.rect) return undefined;
      const [x0, y0, x1, y1] = edit.rect;
      const hits = shown.filter((s) => s.x >= Math.min(x0, x1) && s.x <= Math.max(x0, x1) && s.y >= Math.min(y0, y1) && s.y <= Math.max(y0, y1));
      // Teks tak terlihat (Tr 3/7, lapisan OCR): yang dilihat pengguna ada di gambar, bukan di sini.
      if (hits.length && hits.every((s) => s.renderMode === 3 || s.renderMode === 7)) throw new Error(OCR_ONLY);
      hits.forEach((s) => removed.set(s.op, s.blank));
      // Jangkar = op paling awal di arah baris.
      return hits.sort((a, b) => {
        const r = (a.angle * Math.PI) / 180;
        return (a.x - b.x) * Math.cos(r) + (a.y - b.y) * Math.sin(r);
      })[0];
    });
    if (removed.size) {
      stripMarkedContent(doc, page, ops, removed);
      page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(spliceOps(bytes, removed))));
      // Data cadangan halaman (aplikasi, thumbnail, XMP) bisa memuat salinan teks lama.
      for (const key of ['PieceInfo', 'Thumb', 'Metadata']) page.node.delete(PDFName.of(key));
      prunePageResources(page);
    }

    for (const [i, edit] of pageEdits.entries()) {
      const text = edit.text.replace(/\r/g, '');
      if (!text.trim()) continue;
      const anchor = anchors[i];
      const font = await embed(anchor?.font, text);
      // Font standar hanya WinAnsi; karakter di luarnya diganti agar drawText tidak gagal.
      const charset = new Set(font.getCharacterSet());
      const safe = [...text].map((c) => (c === '\n' || charset.has(c.codePointAt(0)!) ? c : '?')).join('');
      const size = anchor?.size ?? edit.size;
      // Operator sendiri (bukan drawText) agar render mode & garis tepi bold sintetis ikut terbawa.
      const mode = anchor?.renderMode ?? 0;
      const stroked = mode === 1 || mode === 2;
      const ops = [
        pushGraphicsState(),
        setFillingColor(anchor?.color ?? rgb(0, 0, 0)),
        ...(stroked ? [setStrokingColor(anchor!.strokeColor), setLineWidth(anchor!.lineWidth)] : []),
        beginText(),
        setFontAndSize(page.node.newFontDictionary(font.name, font.ref), size),
        setTextRenderingMode(stroked ? (mode as TextRenderingMode) : TextRenderingMode.Fill),
        setLineHeight(size * 1.2),
        rotateAndSkewTextDegreesAndTranslate(anchor?.angle ?? edit.rotation, 0, 0, anchor?.x ?? edit.x, anchor?.y ?? edit.y),
      ];
      safe.split('\n').forEach((line, li) => {
        if (li) ops.push(nextLine());
        ops.push(showText(font.encodeText(line)));
      });
      ops.push(endText(), popGraphicsState());
      page.pushOperators(...ops);
    }
  }
  return rewriteReachable(await doc.save());
}


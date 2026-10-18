import { describe, expect, it, vi } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString, StandardFonts, decodePDFRawStream, rgb, beginText, endText, setFontAndSize, moveText, showText } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { editText } from '../../src/engines/edit-text';
import { parseOps, type Operand } from '../../src/lib/content-stream';
import { addTextLayer } from '../../src/engines/pdf-native';

// edit-verify & panel memakai build browser pdfjs-dist + worker ?url: arahkan ke build legacy di Node.
vi.mock('pdfjs-dist', async () => await vi.importActual('pdfjs-dist/legacy/build/pdf.mjs'));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', async () => {
  const m = (await vi.importActual('pdfjs-dist/legacy/build/pdf.mjs')) as { GlobalWorkerOptions: { workerSrc: string } };
  return { default: m.GlobalWorkerOptions.workerSrc };
});
const { verifyTextEdits } = await import('../../src/lib/edit-verify');
const { toLines, lineRect } = await import('../../src/components/EditTextPanel');

// pdf.js legacy build di Node: cara paling jujur memastikan apa yang bisa diekstrak dari hasil.
async function pageItems(bytes: ArrayBuffer, pageNo = 1) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)), isEvalSupported: false }).promise;
  const items = (await (await doc.getPage(pageNo)).getTextContent()).items as { str: string; transform: number[] }[];
  return items.filter((i) => i.str.trim()).map((i) => ({ str: i.str.trim(), x: Math.round(i.transform[4] * 10) / 10, y: Math.round(i.transform[5] * 10) / 10 }));
}

/**
 * Seluruh isi file — termasuk objek yatim, yang ikut di-parse pdf-lib — dengan string operand teks
 * didekode: pdf-lib menulis teks sebagai hex (<352E30…>), jadi pencarian teks polos saja tidak cukup.
 */
async function fullDump(bytes: ArrayBuffer) {
  const doc = await PDFDocument.load(bytes);
  const strings = (v: Operand): string => (v instanceof Uint8Array ? new TextDecoder('latin1').decode(v) : Array.isArray(v) ? v.map(strings).join('') : '');
  return doc.context.enumerateIndirectObjects().map(([, o]) => {
    if (!(o instanceof PDFRawStream)) return o.toString();
    try {
      const raw = decodePDFRawStream(o).decode();
      return new TextDecoder('latin1').decode(raw) + '\n' + parseOps(raw).map((op) => op.operands.map(strings).join('')).join(' ');
    } catch { return ''; }
  }).join('\n');
}

describe('editText', () => {
  it('replaces a line: old text gone from the whole file, new text at the original baseline, others untouched', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    const font = await doc.embedFont(StandardFonts.TimesRomanBold);
    page.drawText('Nama: Budi Santoso', { x: 50, y: 300, size: 14, font });
    page.drawText('Total Rp 5.000.000', { x: 50, y: 280, size: 14, font, color: rgb(0.8, 0, 0) });
    page.drawText('Terima kasih', { x: 50, y: 260, size: 14, font });

    const out = await editText((await doc.save()).buffer as ArrayBuffer, [
      { page: 0, rect: [49, 276, 200, 294], text: 'Total Rp 3.000.000', x: 50, y: 280, size: 14, rotation: 0 },
    ]);

    expect(await pageItems(out)).toEqual([
      { str: 'Nama: Budi Santoso', x: 50, y: 300 },
      { str: 'Terima kasih', x: 50, y: 260 },
      { str: 'Total Rp 3.000.000', x: 50, y: 280 },
    ]);
    // Bukan sekadar tertutup: string lama tidak ada lagi di objek mana pun dalam file.
    const dump = await fullDump(out);
    expect(dump).not.toContain('5.000.000');
    // Font & warna asli dipakai ulang (Times-Bold, merah).
    expect(dump).toContain('/BaseFont /Times-Bold');
    expect(dump).toMatch(/0\.8 0 0 rg/);
  });

  it('keeps later text in place when an earlier chained Tj on the same line is removed', async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(new Uint8Array(await readFile(path.resolve(__dirname, '../../public/fonts/dm-sans-400.ttf'))).buffer);
    const page = doc.addPage([400, 400]);
    const key = page.node.newFontDictionary(font.name, font.ref);
    // Dua Tj berantai tanpa Td: posisi "Dua" bergantung pada lebar "Satu".
    page.pushOperators(beginText(), setFontAndSize(key, 12), moveText(50, 200), showText(font.encodeText('Satu ')), showText(font.encodeText('Dua')), endText());
    const input = (await doc.save()).buffer as ArrayBuffer;
    const expectedX = 50 + font.widthOfTextAtSize('Satu ', 12);

    const out = await editText(input, [{ page: 0, rect: [49, 196, 52, 210], text: 'Tiga', x: 50, y: 200, size: 12, rotation: 0 }]);
    const after = await pageItems(out);
    const dua = after.find((i) => i.str === 'Dua');
    expect(after.map((i) => i.str)).not.toContain('Satu');
    expect(after.map((i) => i.str)).toContain('Tiga');
    expect(dua?.y).toBe(200);
    expect(dua!.x).toBeCloseTo(expectedX, 0);
  });

  /** Font yang dipakai operator Tf pada content stream halaman hasil (nama BaseFont). */
  async function usedFonts(bytes: ArrayBuffer) {
    const doc = await PDFDocument.load(bytes);
    const page = doc.getPages()[0];
    const fonts = page.node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
    const names = new Map(fonts.entries().map(([k, v]) => [k.decodeText(), (doc.context.lookup(v) as PDFDict).lookup(PDFName.of('BaseFont'))?.toString()]));
    const contents = page.node.Contents()!;
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
    const ops = streams.flatMap((st) => parseOps(decodePDFRawStream(st as PDFRawStream).decode()));
    return { fonts: ops.filter((o) => o.operator === 'Tf').map((o) => names.get(o.operands[0] as string)), ops };
  }

  /** Halaman dengan satu font Type1 tanpa file font, plus content stream mentah. */
  async function pageWithFont(fontDict: Record<string, unknown>, content: string) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    const ref = doc.context.register(doc.context.obj({ Type: 'Font', Subtype: 'Type1', Encoding: 'WinAnsiEncoding', ...fontDict } as never));
    page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: ref } }));
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(content)));
    return (await doc.save()).buffer as ArrayBuffer;
  }

  it('keeps bold/serif declared only in the FontDescriptor (font named freely)', async () => {
    // Nama "F0Custom" tidak menyebut bold — tebal & serif hanya dari Flags (ForceBold | Serif).
    const input = await pageWithFont({ BaseFont: 'F0Custom', FontDescriptor: { Type: 'FontDescriptor', FontName: 'F0Custom', Flags: 0x40000 | 0x20 | 0x2, ItalicAngle: 0 } }, 'BT /F1 14 Tf 50 300 Td (Judul) Tj ET');
    const out = await editText(input, [{ page: 0, rect: [49, 294, 60, 306], text: 'Judul baru', x: 50, y: 300, size: 14, rotation: 0 }]);
    expect((await usedFonts(out)).fonts).toContain('/Times-Bold');
  });

  it('keeps synthetic bold (fill+stroke render mode) on the replacement text', async () => {
    const input = await pageWithFont({ BaseFont: 'Helvetica' }, 'BT /F1 14 Tf 2 Tr 0.6 w 0 0 1 RG 50 300 Td (Tebal) Tj ET');
    const out = await editText(input, [{ page: 0, rect: [49, 294, 60, 306], text: 'Tetap tebal', x: 50, y: 300, size: 14, rotation: 0 }]);
    const { fonts, ops } = await usedFonts(out);
    expect(fonts).toContain('/Helvetica');
    // Hanya blok teks baru (q … Q terakhir): state di stream asli tetap ada dan tak boleh ikut dihitung.
    const block = ops.slice(ops.map((o) => o.operator).lastIndexOf('q'));
    const has = (operator: string, operands: string) => block.some((o) => o.operator === operator && o.operands.join(' ') === operands);
    expect(has('Tr', '2') && has('w', '0.6') && has('RG', '0 0 1')).toBe(true);
    expect(await pageItems(out)).toEqual([{ str: 'Tetap tebal', x: 50, y: 300 }]);
  });

  it('adds new text at the given point', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 300]);
    const out = await editText((await doc.save()).buffer as ArrayBuffer, [{ page: 0, text: 'Catatan baru', x: 20, y: 40, size: 10, rotation: 0 }]);
    expect(await pageItems(out)).toEqual([{ str: 'Catatan baru', x: 20, y: 40 }]);
  });
});

describe('editText — sisa teks lama di luar glyph', () => {
  it('refuses lines that are only invisible OCR text over a scan', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    const ctx = doc.context;
    const scan = ctx.register(ctx.flateStream('OLDVALUE', { Type: 'XObject', Subtype: 'Image', Width: 8, Height: 1, BitsPerComponent: 8, ColorSpace: 'DeviceGray' }));
    page.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { ImX: scan } }));
    page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream('q 300 0 0 60 40 260 cm /ImX Do Q')));
    const scanned = await addTextLayer((await doc.save()).buffer as ArrayBuffer, [[{ text: 'Rekening 9876543210', x: 40, y: 280, size: 20, width: 300, rotation: 0 }]]);
    await expect(editText(scanned, [{ page: 0, rect: [39, 271, 345, 289], text: '', x: 40, y: 280, size: 20, rotation: 0 }])).rejects.toThrow(/Sensor PDF/);
  });

  it('drops ActualText/Alt/E of marked content wrapping removed text — inline, inside BT, and named', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const ctx = doc.context;
    page.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font.ref }, Properties: { MC0: { ActualText: PDFString.of('RAHASIA-PROP') } } }));
    page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream([
      '/Span <</ActualText (RAHASIA-AT)>> BDC BT /F1 12 Tf 50 300 Td (Lama satu) Tj ET EMC',
      'BT /F1 12 Tf 50 250 Td /Span <</MCID 3 /ActualText (RAHASIA-IN) /Alt (RAHASIA-ALT) /E (RAHASIA-E)>> BDC (Lama dua) Tj EMC ET',
      '/Span /MC0 BDC BT /F1 12 Tf 50 200 Td (Lama tiga) Tj ET EMC',
      '/Span <</ActualText (TETAP-AT)>> BDC BT /F1 12 Tf 50 150 Td (Tetap) Tj ET EMC',
    ].join('\n'))));
    const out = await editText((await doc.save()).buffer as ArrayBuffer, [300, 250, 200].map((y) => ({ page: 0, rect: [49, y - 6, 200, y + 6] as [number, number, number, number], text: 'Baru', x: 50, y, size: 12, rotation: 0 })));
    const dump = await fullDump(out);
    expect(dump).not.toContain('RAHASIA');
    expect(dump).not.toContain('Lama');
    expect(dump).toContain('TETAP-AT');
    expect(dump).toMatch(/\/MCID 3/);
  });

  it('cleans the owning structure element and the page side data, nothing else', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const ctx = doc.context;
    page.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font.ref } }));
    page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream('/P <</MCID 0>> BDC BT /F1 12 Tf 50 300 Td (Lama) Tj ET EMC /Figure <</MCID 1>> BDC BT /F1 12 Tf 50 200 Td (Tetap) Tj ET EMC')));
    const root = ctx.nextRef();
    const elem = (o: Record<string, unknown>) => ctx.register(ctx.obj({ Type: 'StructElem', P: root, Pg: page.ref, ...o } as never));
    const edited = elem({ S: 'P', K: 0, ActualText: PDFString.of('RAHASIA-SE-AT'), Alt: PDFString.of('RAHASIA-SE-ALT'), E: PDFString.of('RAHASIA-SE-E') });
    const other = elem({ S: 'Figure', K: 1, Alt: PDFString.of('TETAP-ALT') });
    ctx.assign(root, ctx.obj({ Type: 'StructTreeRoot', K: [edited, other], ParentTree: { Nums: [0, [edited, other]] }, ParentTreeNextKey: 1 }));
    doc.catalog.set(PDFName.of('StructTreeRoot'), root);
    page.node.set(PDFName.of('StructParents'), ctx.obj(0));
    page.node.set(PDFName.of('PieceInfo'), ctx.obj({ App: { Private: PDFString.of('RAHASIA-PIECE') } }));
    page.node.set(PDFName.of('Thumb'), ctx.register(ctx.flateStream('RAHASIA-THUMB')));
    page.node.set(PDFName.of('Metadata'), ctx.register(ctx.stream('<x:xmpmeta>RAHASIA-PAGEXMP</x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' })));
    const out = await editText((await doc.save()).buffer as ArrayBuffer, [{ page: 0, rect: [49, 294, 200, 306], text: 'Baru', x: 50, y: 300, size: 12, rotation: 0 }]);
    const dump = await fullDump(out);
    expect(dump).not.toContain('RAHASIA');
    expect(dump).toContain('TETAP-ALT');
  });
});

describe('verifyTextEdits', () => {
  const make = async (lines: [string, number][]) => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    for (const [text, y] of lines) page.drawText(text, { x: 50, y, size: 12 });
    return (await doc.save()).buffer as ArrayBuffer;
  };
  const edit = (text: string) => [{ page: 0, rect: [49, 294, 200, 306] as [number, number, number, number], text, x: 50, y: 300, size: 12, rotation: 0 }];

  it('flags leftover old text in any script, not just ASCII', async () => {
    const before = await make([['ÄÖÜßÉØ', 300], ['Tetap', 200]]);
    expect(await verifyTextEdits(before, before, edit('Baru'))).toHaveLength(1);
  });

  it('flags an old item left in place even when the new text contains it', async () => {
    // Teks baru jatuh di luar area baris; potongan lama "Saldo 100" adalah bagian dari "Saldo 1000".
    const before = await make([['Saldo 100', 300]]);
    expect(await verifyTextEdits(before, await make([['Saldo 100', 300], ['Saldo 1000', 250]]), edit('Saldo 1000'))).toHaveLength(1);
    expect(await verifyTextEdits(before, await make([['Saldo 1000', 300]]), edit('Saldo 1000'))).toEqual([]);
  });
});

describe('EditTextPanel area hapus', () => {
  const font = { family: '', bold: false, italic: false };
  // Baris dirakit seperti di panel (item pdf.js digabung), area dari lineRect, lalu dihapus engine.
  async function editFirstLine(bytes: ArrayBuffer) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)), isEvalSupported: false }).promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const [line] = toLines((await page.getTextContent()).items as never, viewport, () => font);
    await doc.destroy();
    const [x, y] = viewport.convertToPdfPoint(line.x, line.baseline);
    return editText(bytes, [{ page: 0, rect: lineRect(viewport, line), text: 'Saldo Rp 0', x, y, size: line.size, rotation: 0 }]);
  }

  it('covers a merged fragment slightly above the baseline of tiny text', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('Saldo Rp 5.000.000', { x: 50, y: 300, size: 4, font: helv });
    page.drawText('RAHASIA77', { x: 52 + helv.widthOfTextAtSize('Saldo Rp 5.000.000', 4), y: 301.9, size: 4, font: helv });
    const out = await editFirstLine((await doc.save()).buffer as ArrayBuffer);
    expect((await pageItems(out)).map((i) => i.str).join(' ')).not.toContain('RAHASIA');
  });

  it('covers a merged item that starts left of the first one', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    page.drawText('1', { x: 100, y: 300, size: 12 });
    page.drawText('RAHASIA', { x: 96, y: 300, size: 12 });
    const out = await editFirstLine((await doc.save()).buffer as ArrayBuffer);
    expect((await pageItems(out)).map((i) => i.str).join(' ')).not.toContain('RAHASIA');
  });
});

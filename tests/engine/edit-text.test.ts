import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream, rgb, beginText, endText, setFontAndSize, moveText, showText } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { editText } from '../../src/engines/edit-text';
import { parseOps, type Operand } from '../../src/lib/content-stream';

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

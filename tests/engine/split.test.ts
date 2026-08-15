import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { splitPdfEach, splitPdfRanges, splitPdfGroups } from '../../src/engines/pdf-native';

async function makeTestPdf(pages: number): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([200, 300]);
    page.drawText(`Page ${i + 1}`, { x: 50, y: 250, size: 24 });
  }
  return (await doc.save()).buffer as ArrayBuffer;
}

async function pageCount(bytes: ArrayBuffer): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}

describe('splitPdfEach', () => {
  it('extracts each selected page into a separate PDF', async () => {
    const input = await makeTestPdf(5);
    const outputs = await splitPdfEach(input, [0, 2, 4]);
    expect(outputs).toHaveLength(3);
    for (const out of outputs) {
      expect(await pageCount(out)).toBe(1);
    }
  });

  it('filters out-of-bounds indices', async () => {
    const input = await makeTestPdf(3);
    const outputs = await splitPdfEach(input, [0, 1, 99]);
    expect(outputs).toHaveLength(2);
  });

  it('throws when no valid pages', async () => {
    const input = await makeTestPdf(2);
    await expect(splitPdfEach(input, [])).rejects.toThrow('Tidak ada halaman valid');
  });
});

describe('splitPdfRanges', () => {
  it('splits by inclusive ranges', async () => {
    const input = await makeTestPdf(10);
    const outputs = await splitPdfRanges(input, [[0, 4], [5, 9]]);
    expect(outputs).toHaveLength(2);
    expect(await pageCount(outputs[0])).toBe(5);
    expect(await pageCount(outputs[1])).toBe(5);
  });

  it('handles single-page ranges', async () => {
    const input = await makeTestPdf(5);
    const outputs = await splitPdfRanges(input, [[0, 0], [4, 4]]);
    expect(outputs).toHaveLength(2);
    expect(await pageCount(outputs[0])).toBe(1);
    expect(await pageCount(outputs[1])).toBe(1);
  });

  it('throws on out-of-bounds range', async () => {
    const input = await makeTestPdf(5);
    await expect(splitPdfRanges(input, [[0, 9]])).rejects.toThrow('tidak valid');
  });

  it('preserves page content order within range', async () => {
    const input = await makeTestPdf(6);
    const outputs = await splitPdfRanges(input, [[2, 4]]);
    expect(outputs).toHaveLength(1);
    expect(await pageCount(outputs[0])).toBe(3);
  });
});

describe('splitPdfGroups', () => {
  it('groups arbitrary pages into separate PDFs', async () => {
    const input = await makeTestPdf(10);
    const outputs = await splitPdfGroups(input, [[0, 2, 4], [1, 5, 8]]);
    expect(outputs).toHaveLength(2);
    expect(await pageCount(outputs[0])).toBe(3);
    expect(await pageCount(outputs[1])).toBe(3);
  });

  it('allows overlapping pages across groups', async () => {
    const input = await makeTestPdf(5);
    const outputs = await splitPdfGroups(input, [[0, 1], [1, 2]]);
    expect(outputs).toHaveLength(2);
    expect(await pageCount(outputs[0])).toBe(2);
    expect(await pageCount(outputs[1])).toBe(2);
  });

  it('skips empty groups', async () => {
    const input = await makeTestPdf(3);
    const outputs = await splitPdfGroups(input, [[], [0, 1]]);
    expect(outputs).toHaveLength(1);
  });

  it('throws when all groups are empty or invalid', async () => {
    const input = await makeTestPdf(3);
    await expect(splitPdfGroups(input, [[], []])).rejects.toThrow('Tidak ada kelompok');
  });

  it('throws when group contains out-of-bounds pages', async () => {
    const input = await makeTestPdf(3);
    await expect(splitPdfGroups(input, [[0, 99]])).rejects.toThrow('di luar batas');
  });
});

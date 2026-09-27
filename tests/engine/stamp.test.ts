import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { stampImage } from '../../src/engines/pdf-native';

async function makePdf(pages: number): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([200, 300]);
    page.drawText(`Page ${i + 1}`, { x: 50, y: 250, size: 24 });
  }
  return (await doc.save()).buffer as ArrayBuffer;
}

// PNG 1x1 valid (piksel buram) untuk embed.
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function tinyPng(): ArrayBuffer {
  return new Uint8Array(Buffer.from(PNG_BASE64, 'base64')).buffer as ArrayBuffer;
}

async function hasEmbeddedImage(bytes: ArrayBuffer): Promise<boolean> {
  const doc = await PDFDocument.load(bytes);
  return doc.context.enumerateIndirectObjects().some(([, obj]) => obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype'))?.toString() === '/Image');
}

describe('stampImage', () => {
  it('menempelkan gambar hanya pada halaman target', async () => {
    const pdf = await makePdf(2);
    expect(await hasEmbeddedImage(pdf)).toBe(false);
    const out = await stampImage(pdf, {
      imageBytes: tinyPng(), imageType: 'png', pages: [0], xPct: 60, yPct: 70, widthPct: 20, opacity: 0.9,
    });
    expect(await PDFDocument.load(out).then((d) => d.getPageCount())).toBe(2);
    expect(await hasEmbeddedImage(out)).toBe(true);
  });

  it('melempar error jika tidak ada halaman valid', async () => {
    const pdf = await makePdf(2);
    await expect(stampImage(pdf, {
      imageBytes: tinyPng(), imageType: 'png', pages: [5], xPct: 10, yPct: 10, widthPct: 20, opacity: 1,
    })).rejects.toThrow('Tidak ada halaman valid');
  });

  it('menempelkan ke semua halaman saat diminta', async () => {
    const pdf = await makePdf(3);
    const out = await stampImage(pdf, {
      imageBytes: tinyPng(), imageType: 'png', pages: [0, 1, 2], xPct: 50, yPct: 50, widthPct: 10, opacity: 1,
    });
    expect(await hasEmbeddedImage(out)).toBe(true);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { createPdfToolkit } from 'pdfstudio';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  deletePages, reorderPages, addPageNumbers, addWatermark, drawTextBlockCentered, rotatePdf, watermarkCenters,
  updateMetadata, cropPages, compressPdf, jpegsToPdf, unlockPdf,
} from '../../src/engines/pdf-native';

async function makePdf(pages: number): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([200, 300]);
    page.drawText(`Page ${i + 1}`, { x: 50, y: 250, size: 24 });
  }
  return (await doc.save()).buffer as ArrayBuffer;
}

async function countPages(bytes: ArrayBuffer): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}

function fontPath(name: string): string {
  return path.resolve(__dirname, '../../public/fonts', name);
}

describe('deletePages', () => {
  it('removes specified pages', async () => {
    const input = await makePdf(5);
    const output = await deletePages(input, [1, 3]);
    expect(await countPages(output)).toBe(3);
  });

  it('keeps pages not in delete list', async () => {
    const input = await makePdf(4);
    const output = await deletePages(input, [0]);
    const doc = await PDFDocument.load(output);
    expect(doc.getPageCount()).toBe(3);
  });

  it('throws when deleting all pages', async () => {
    const input = await makePdf(2);
    await expect(deletePages(input, [0, 1])).rejects.toThrow('Tidak dapat menghapus semua halaman');
  });

  it('ignores out-of-bounds indices', async () => {
    const input = await makePdf(3);
    const output = await deletePages(input, [0, 99]);
    expect(await countPages(output)).toBe(2);
  });
});

describe('reorderPages', () => {
  it('reorders pages according to new order', async () => {
    const input = await makePdf(3);
    const output = await reorderPages(input, [2, 0, 1]);
    expect(await countPages(output)).toBe(3);
  });

  it('allows duplicate pages', async () => {
    const input = await makePdf(2);
    const output = await reorderPages(input, [0, 0, 1, 1]);
    expect(await countPages(output)).toBe(4);
  });

  it('throws for empty order', async () => {
    const input = await makePdf(3);
    await expect(reorderPages(input, [])).rejects.toThrow('tidak valid');
  });
});

describe('addPageNumbers', () => {
  it('adds page numbers without changing page count', async () => {
    const input = await makePdf(5);
    const output = await addPageNumbers(input, { position: 'bottom-center' });
    expect(await countPages(output)).toBe(5);
  });

  it('respects startFrom option', async () => {
    const input = await makePdf(3);
    const output = await addPageNumbers(input, { startFrom: 5 });
    expect(await countPages(output)).toBe(3);
  });

  it('supports page-of format', async () => {
    const input = await makePdf(3);
    const output = await addPageNumbers(input, { format: 'page-of' });
    expect(await countPages(output)).toBe(3);
  });

  it('supports roman numeral format', async () => {
    const input = await makePdf(4);
    const output = await addPageNumbers(input, { format: 'roman' });
    expect(await countPages(output)).toBe(4);
  });
});

describe('rotatePdf', () => {
  it('merotasi semua halaman (format lama, angka)', async () => {
    const input = await makePdf(3);
    const output = await rotatePdf(input, 90);
    const doc = await PDFDocument.load(output);
    doc.getPages().forEach((p) => expect(p.getRotation().angle).toBe(90));
  });

  it('merotasi hanya halaman terpilih via pages[]', async () => {
    const input = await makePdf(3);
    const output = await rotatePdf(input, { angle: 180, pages: [0, 2] });
    const doc = await PDFDocument.load(output);
    const angles = doc.getPages().map((p) => p.getRotation().angle);
    expect(angles).toEqual([180, 0, 180]);
  });

  it('sudut berbeda per halaman bisa diakumulasikan', async () => {
    const input = await makePdf(2);
    const step1 = await rotatePdf(input, { angle: 90, pages: [0] });
    const step2 = await rotatePdf(step1, { angle: 270, pages: [1] });
    const doc = await PDFDocument.load(step2);
    const angles = doc.getPages().map((p) => p.getRotation().angle);
    expect(angles).toEqual([90, 270]);
  });

  it('menormalkan sudut negatif', async () => {
    const input = await makePdf(1);
    const output = await rotatePdf(input, { angle: -90 });
    const doc = await PDFDocument.load(output);
    expect(doc.getPage(0).getRotation().angle).toBe(270);
  });

  it('sudut 360 tidak mengubah apa pun', async () => {
    const input = await makePdf(1);
    const output = await rotatePdf(input, { angle: 360 });
    const doc = await PDFDocument.load(output);
    expect(doc.getPage(0).getRotation().angle).toBe(0);
  });

  it('menolak indeks halaman tidak valid', async () => {
    const input = await makePdf(2);
    await expect(rotatePdf(input, { angle: 90, pages: [5] })).rejects.toThrow('tidak valid');
  });

  it('indeks duplikat hanya dirotasi sekali', async () => {
    const input = await makePdf(1);
    const output = await rotatePdf(input, { angle: 90, pages: [0, 0, 0] });
    const doc = await PDFDocument.load(output);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
  });
});

describe('addWatermark', () => {
  it('adds watermark text to all pages', async () => {
    const input = await makePdf(3);
    const output = await addWatermark(input, { text: 'CONFIDENTIAL' });
    expect(await countPages(output)).toBe(3);
  });

  it('throws on empty text', async () => {
    const input = await makePdf(2);
    await expect(addWatermark(input, { text: '' })).rejects.toThrow('tidak boleh kosong');
    await expect(addWatermark(input, { text: '   ' })).rejects.toThrow('tidak boleh kosong');
  });

  it('respects opacity and rotation options', async () => {
    const input = await makePdf(2);
    const output = await addWatermark(input, { text: 'DRAFT', opacity: 0.5, rotation: 30 });
    expect(await countPages(output)).toBe(2);
  });
});

describe('addWatermark — opsi lanjutan', () => {
  it('menggambar teks multi-baris (\\n)', async () => {
    const input = await makePdf(2);
    const output = await addWatermark(input, { text: 'BARIS SATU\nBARIS DUA', fontSize: 20, lineHeight: 1.5 });
    expect(await countPages(output)).toBe(2);
  });

  it('menerima letterSpacing positif', async () => {
    const input = await makePdf(1);
    const output = await addWatermark(input, { text: 'S P A S I', letterSpacing: 5, fontSize: 20 });
    expect(await countPages(output)).toBe(1);
  });

  it('menerima letterSpacing negatif (merapatkan)', async () => {
    const input = await makePdf(1);
    const output = await addWatermark(input, { text: 'RAPAT', letterSpacing: -3, fontSize: 20 });
    expect(await countPages(output)).toBe(1);
  });

  it('menjepit letterSpacing negatif ekstrem agar tidak bertumpuk terbalik', async () => {
    const input = await makePdf(1);
    const output = await addWatermark(input, { text: 'NEG', letterSpacing: -99, fontSize: 20 });
    expect(await countPages(output)).toBe(1);
  });

  it('tinggi baris memengaruhi jarak antar baris (multi-baris valid)', async () => {
    const input = await makePdf(1);
    const outA = await addWatermark(input, { text: 'A\nB', lineHeight: 0.8, fontSize: 30 });
    const outB = await addWatermark(input, { text: 'A\nB', lineHeight: 2.5, fontSize: 30 });
    expect(await countPages(outA)).toBe(1);
    expect(await countPages(outB)).toBe(1);

    // Verifikasi deterministik: jarak antar baris = lineHeight × size
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const opts = (lineHeight: number) => ({ font, size: 30, color: rgb(0, 0, 0), opacity: 1, rotation: 0, spacing: 0, lineHeight });
    const run = (lineHeight: number) => {
      const ys: number[] = [];
      const fakePage = { drawText: (_t: string, o: { y: number }) => { ys.push(o.y); } } as never;
      drawTextBlockCentered(fakePage, 'A\nB', 100, 100, opts(lineHeight));
      return ys;
    };
    const yA = run(0.8);
    const yB = run(2.5);
    expect(yA[0] - yA[1]).toBeCloseTo(0.8 * 30, 1);
    expect(yB[0] - yB[1]).toBeCloseTo(2.5 * 30, 1);
    expect(yA[0]).not.toBe(yB[0]);
  });

  it('menerapkan offsetX/offsetY', async () => {
    const input = await makePdf(1);
    const output = await addWatermark(input, { text: 'GESER', offsetX: 60, offsetY: -40, fontSize: 20 });
    expect(await countPages(output)).toBe(1);
  });

  it('menerapkan letter spacing pada mode tiled', async () => {
    const input = await makePdf(1);
    const output = await addWatermark(input, { text: 'UBIN', type: 'tiled', letterSpacing: 4, fontSize: 16, rotation: 30 });
    expect(await countPages(output)).toBe(1);
  });

  it('menerapkan letter spacing pada mode positioned', async () => {
    const input = await makePdf(1);
    const output = await addWatermark(input, { text: 'POJOK', type: 'positioned', position: 'top-left', letterSpacing: 3, fontSize: 16 });
    expect(await countPages(output)).toBe(1);
  });

  it('tileGap memengaruhi kepadatan ubin — kecil = lebih banyak', () => {
    const countTiles = (gap: number) =>
      watermarkCenters('tiled', 'center', 595, 842, { w: 100, h: 0, stepX: 100 + gap, stepY: 20 + gap }, 40).length;
    const dense = countTiles(20);   // rapat
    const sparse = countTiles(200); // renggang
    expect(dense).toBeGreaterThan(sparse);
    expect(dense).toBeGreaterThan(50);
    expect(sparse).toBeGreaterThan(0);
  });

  it('watermarkCenters: pojok tanpa rotasi, offset + = kanan/bawah', () => {
    const box = { w: 100, h: 50, stepX: 0, stepY: 0 };
    expect(watermarkCenters('positioned', 'top-left', 600, 800, box, 40)).toEqual([{ x: 90, y: 65, rotate: false }]);
    expect(watermarkCenters('positioned', 'bottom-right', 600, 800, box, 40)).toEqual([{ x: 510, y: 735, rotate: false }]);
    expect(watermarkCenters('center', 'center', 600, 800, box, 40, 10, 20)).toEqual([{ x: 310, y: 420, rotate: true }]);
  });

  it('addWatermark menerima tileGap dan menghasilkan PDF valid', async () => {
    const input = await makePdf(2);
    const output = await addWatermark(input, { text: 'UBIN', type: 'tiled', tileGap: 120, fontSize: 20, rotation: 30 });
    expect(await countPages(output)).toBe(2);
  });
});

const TINY_PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')).buffer as ArrayBuffer;

describe('addWatermark — gambar', () => {
  it.each(['center', 'tiled', 'positioned'] as const)('mode %s menghasilkan PDF valid tanpa teks', async (type) => {
    const input = await makePdf(2);
    const output = await addWatermark(input, { type, position: 'top-right', imageBytes: TINY_PNG, imageType: 'png', imageScale: 0.2, rotation: 30, tileGap: 20 });
    expect(await countPages(output)).toBe(2);
  });

  it('gambar berotasi tetap berpusat di titik tata letak (offset + = bawah)', async () => {
    const spy = vi.spyOn(PDFPage.prototype, 'drawImage');
    // Halaman 200×300, gambar 1×1 pada skala 0.5 → kotak 100×100
    await addWatermark(await makePdf(1), { imageBytes: TINY_PNG, imageType: 'png', imageScale: 0.5, rotation: 45, offsetY: 20 });
    const o = spy.mock.calls[0][1]!;
    spy.mockRestore();
    const r = (45 * Math.PI) / 180;
    const cx = o.x! + (o.width! / 2) * Math.cos(r) - (o.height! / 2) * Math.sin(r);
    const cy = o.y! + (o.width! / 2) * Math.sin(r) + (o.height! / 2) * Math.cos(r);
    expect(cx).toBeCloseTo(100, 6);
    expect(cy).toBeCloseTo(150 - 20, 6);
  });
});

describe('addWatermark — font kustom (TTF/OTF)', () => {
  it('embed font TTF yang diunggah via customFontBytes', async () => {
    const input = await makePdf(2);
    const fontBytes = new Uint8Array(await readFile(fontPath('dm-sans-400.ttf')));
    const output = await addWatermark(input, { text: 'FONT KUSTOM', customFontBytes: fontBytes.buffer, fontSize: 20 });
    expect(await countPages(output)).toBe(2);
    // Output harus valid & memuat font
    const doc = await PDFDocument.load(output);
    expect(doc.getPageCount()).toBe(2);
  });

  it('embed font kustom dengan letter spacing + multi-baris', async () => {
    const input = await makePdf(1);
    const fontBytes = new Uint8Array(await readFile(fontPath('playfair-700.ttf')));
    const output = await addWatermark(input, {
      text: 'RAHASIA\nDOKUMEN',
      customFontBytes: fontBytes.buffer,
      fontSize: 24,
      letterSpacing: 2,
      lineHeight: 1.4,
      rotation: 45,
    });
    expect(await countPages(output)).toBe(1);
  });

  it('menolak bytes font yang tidak valid dengan pesan jelas', async () => {
    const input = await makePdf(1);
    const bogus = new Uint8Array([0x00, 0xff, 0x00, 0xff, 0x00, 0xff, 0x00, 0xff]).buffer;
    await expect(
      addWatermark(input, { text: 'X', customFontBytes: bogus }),
    ).rejects.toThrow('Font yang diunggah tidak dapat diproses');
  });

  it('font bawaan tetap jalan tanpa customFontBytes', async () => {
    const input = await makePdf(1);
    const output = await addWatermark(input, { text: 'BAWAAN', font: 'times-bold' });
    expect(await countPages(output)).toBe(1);
  });
});

describe('updateMetadata', () => {
  it('sets title and author', async () => {
    const input = await makePdf(1);
    const output = await updateMetadata(input, { title: 'Test Doc', author: 'Tester' });
    const doc = await PDFDocument.load(output);
    expect(doc.getTitle()).toBe('Test Doc');
    expect(doc.getAuthor()).toBe('Tester');
  });

  it('parses keywords from comma-separated string', async () => {
    const input = await makePdf(1);
    const output = await updateMetadata(input, { keywords: 'alpha, beta, gamma' });
    const doc = await PDFDocument.load(output);
    expect(doc.getKeywords()).toContain('alpha');
    expect(doc.getKeywords()).toContain('beta');
    expect(doc.getKeywords()).toContain('gamma');
  });
});

describe('cropPages', () => {
  it('sets crop box with margins', async () => {
    const input = await makePdf(2);
    const output = await cropPages(input, { top: 20, bottom: 20, left: 10, right: 10 });
    expect(await countPages(output)).toBe(2);
  });

  it('throws when margins too large', async () => {
    const input = await makePdf(1);
    await expect(cropPages(input, { top: 500, bottom: 500 })).rejects.toThrow('terlalu besar');
  });

  it('throws on negative margins', async () => {
    const input = await makePdf(1);
    await expect(cropPages(input, { top: -10 })).rejects.toThrow('negatif');
  });
});

describe('cropPages — per halaman', () => {
  it('hanya memotong halaman yang ditentukan', async () => {
    const input = await makePdf(3);
    const output = await cropPages(input, { pages: [{ index: 1, top: 10, bottom: 10, left: 5, right: 5 }] });
    const doc = await PDFDocument.load(output);
    expect(doc.getPageCount()).toBe(3);
    const boxes = doc.getPages().map((p) => p.getCropBox());
    expect(boxes[0].width).toBe(200);
    expect(boxes[0].height).toBe(300);
    expect(boxes[1].width).toBeCloseTo(190, 5);
    expect(boxes[1].height).toBeCloseTo(280, 5);
    expect(boxes[2].width).toBe(200);
  });

  it('mendukung margin berbeda per halaman', async () => {
    const input = await makePdf(3);
    const output = await cropPages(input, {
      pages: [
        { index: 0, top: 20 },
        { index: 2, left: 30, right: 10 },
      ],
    });
    const doc = await PDFDocument.load(output);
    const boxes = doc.getPages().map((p) => p.getCropBox());
    expect(boxes[0].height).toBeCloseTo(280, 5);
    expect(boxes[1].width).toBe(200); // tidak tersentuh
    expect(boxes[2].width).toBeCloseTo(160, 5);
  });

  it('menolak indeks di luar rentang', async () => {
    const input = await makePdf(2);
    await expect(cropPages(input, { pages: [{ index: 5, top: 10 }] })).rejects.toThrow('tidak valid');
    await expect(cropPages(input, { pages: [{ index: -1, top: 10 }] })).rejects.toThrow('tidak valid');
  });

  it('menolak indeks duplikat', async () => {
    const input = await makePdf(2);
    await expect(cropPages(input, { pages: [{ index: 0, top: 1 }, { index: 0, top: 2 }] })).rejects.toThrow('duplikat');
  });

  it('menolak margin negatif per halaman', async () => {
    const input = await makePdf(2);
    await expect(cropPages(input, { pages: [{ index: 0, left: -5 }] })).rejects.toThrow('negatif');
  });

  it('margin global tetap berjalan tanpa pages', async () => {
    const input = await makePdf(2);
    const output = await cropPages(input, { top: 10, bottom: 10 });
    const doc = await PDFDocument.load(output);
    doc.getPages().forEach((p) => {
      expect(p.getCropBox().height).toBeCloseTo(280, 5);
    });
  });
});

describe('compressPdf', () => {
  it('produces valid PDF', async () => {
    const input = await makePdf(3);
    const output = await compressPdf(input);
    expect(await countPages(output)).toBe(3);
  });

  it('sets creator to PrivaPDF', async () => {
    const input = await makePdf(1);
    const output = await compressPdf(input);
    const doc = await PDFDocument.load(output);
    expect(doc.getCreator()).toBe('PrivaPDF');
  });
});

describe('jpegsToPdf', () => {
  // Header JPEG minimal (SOI + SOF0): pdf-lib hanya membaca dimensi, tidak mendekode.
  const jpeg = (w: number, h: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]).buffer;

  it('restores page size in points from render scale', async () => {
    const output = await jpegsToPdf([jpeg(1190, 1684), jpeg(1684, 1190)], 2);
    const doc = await PDFDocument.load(output);
    expect(doc.getPages().map((p) => [p.getWidth(), p.getHeight()])).toEqual([[595, 842], [842, 595]]);
  });
});

describe('unlockPdf', () => {
  it('loads unencrypted PDF unchanged', async () => {
    const input = await makePdf(2);
    const output = await unlockPdf(input);
    expect(await countPages(output)).toBe(2);
  });

  it('removes a user password from an encrypted PDF', async () => {
    const toolkit = await createPdfToolkit();
    const plain = await makePdf(2);
    const locked = await toolkit.lock(new Uint8Array(plain), { userPassword: 'rahasia' });

    // Terkunci: unlock tanpa password harus ditolak.
    await expect(unlockPdf(toArrayBuffer(locked))).rejects.toThrow(/memerlukan password/i);

    const output = await unlockPdf(toArrayBuffer(locked), 'rahasia');
    const outBytes = new Uint8Array(output);
    expect(await countPages(output)).toBe(2);
    // Hasil harus sudah tidak terenkripsi.
    await expect(toolkit.isEncrypted(outBytes)).resolves.toBe(false);
  });

  it('rejects a wrong password', async () => {
    const toolkit = await createPdfToolkit();
    const plain = await makePdf(1);
    const locked = await toolkit.lock(new Uint8Array(plain), { userPassword: 'rahasia' });
    await expect(unlockPdf(toArrayBuffer(locked), 'salah')).rejects.toThrow(/password salah/i);
  });
});

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

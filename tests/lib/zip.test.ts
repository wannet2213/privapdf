import { describe, expect, it } from 'vitest';
import { unzip } from 'fflate';
import { createZip } from '../../src/lib/zip';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Bongkar ZIP (via fflate) menjadi Record<nama, teks>. */
function unzipText(buf: ArrayBuffer): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    unzip(new Uint8Array(buf), (err, files) => {
      if (err) { reject(err); return; }
      const out: Record<string, string> = {};
      for (const [name, data] of Object.entries(files)) {
        if (name.endsWith('/')) continue; // lewati entri direktori
        out[name] = dec.decode(data);
      }
      resolve(out);
    });
  });
}

describe('createZip', () => {
  it('membuat arsip valid yang bisa dibongkar kembali', async () => {
    const blob = await createZip([
      { name: 'a.pdf', bytes: enc.encode('PDF-A').buffer },
      { name: 'b.pdf', bytes: enc.encode('PDF-B').buffer },
    ]);
    expect(blob.type).toBe('application/zip');
    const files = await unzipText(await blob.arrayBuffer());
    expect(files['a.pdf']).toBe('PDF-A');
    expect(files['b.pdf']).toBe('PDF-B');
  });

  it('header ZIP dimulai dengan magic bytes PK\\x03\\x04', async () => {
    const blob = await createZip([{ name: 'x.txt', bytes: enc.encode('hi').buffer }]);
    const head = new Uint8Array(await blob.arrayBuffer()).subarray(0, 4);
    expect([...head]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('memberi nomor otomatis pada nama duplikat', async () => {
    const blob = await createZip([
      { name: 'sama.pdf', bytes: enc.encode('1').buffer },
      { name: 'sama.pdf', bytes: enc.encode('2').buffer },
      { name: 'sama.pdf', bytes: enc.encode('3').buffer },
    ]);
    const files = await unzipText(await blob.arrayBuffer());
    expect(Object.keys(files).sort()).toEqual(['sama-2.pdf', 'sama-3.pdf', 'sama.pdf']);
    expect(files['sama.pdf']).toBe('1');
    expect(files['sama-2.pdf']).toBe('2');
    expect(files['sama-3.pdf']).toBe('3');
  });

  it('mempertahankan nama dengan sub-direktori', async () => {
    const blob = await createZip([{ name: 'folder/doc.pdf', bytes: enc.encode('X').buffer }]);
    const files = await unzipText(await blob.arrayBuffer());
    expect(files['folder/doc.pdf']).toBe('X');
  });

  it('menolak input kosong', async () => {
    await expect(createZip([])).rejects.toThrow('Tidak ada file');
  });

  it('bisa dipakai untuk file PDF hasil split asli', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    doc.addPage([200, 300]);
    doc.addPage([200, 300]);
    const out1 = new Uint8Array(await (async () => {
      const d = await PDFDocument.create();
      const [pg] = await d.copyPages(doc, [0]);
      d.addPage(pg);
      return d.save();
    })());
    const blob = await createZip([{ name: 'doc-hal-1.pdf', bytes: out1.buffer }]);
    const zipBytes = new Uint8Array(await blob.arrayBuffer());
    expect(zipBytes.length).toBeGreaterThan(100);
    expect(zipBytes[0]).toBe(0x50); // P
    expect(zipBytes[1]).toBe(0x4b); // K
  });
});

import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, PDFString, decodePDFRawStream, type PDFRef } from 'pdf-lib';
import { deletePages, splitPdfEach, splitPdfRanges, splitPdfGroups, mergePages, redactPdf } from '../../src/engines/pdf-native';

// pdf-client memakai build browser pdfjs-dist + worker ?url: arahkan ke build legacy agar jalan di Node.
vi.mock('pdfjs-dist', async () => await vi.importActual('pdfjs-dist/legacy/build/pdf.mjs'));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', async () => {
  const m = (await vi.importActual('pdfjs-dist/legacy/build/pdf.mjs')) as { GlobalWorkerOptions: { workerSrc: string } };
  return { default: m.GlobalWorkerOptions.workerSrc };
});
const { assertSamePageOrder, PAGE_ORDER_MISMATCH } = await import('../../src/lib/pdf-client');

const latin1 = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

/** Semua objek + stream terdekompresi (setara qpdf --qdf) — sisa halaman yang dibuang tak boleh ada di sini. */
async function dump(bytes: ArrayBuffer) {
  const doc = await PDFDocument.load(bytes);
  const text = doc.context.enumerateIndirectObjects().map(([, o]) => {
    if (!(o instanceof PDFRawStream)) return o.toString();
    try { return o.dict.toString() + latin1(decodePDFRawStream(o).decode()); } catch { return o.dict.toString() + latin1(o.contents); }
  }).join('\n');
  const pageDicts = (text.match(/\/Type \/Page\b(?!s)/g) ?? []).length;
  return { text, pageDicts, pageCount: doc.getPageCount() };
}

// Hapus halaman 2 lewat tiap jalur buang-halaman.
const REMOVE_PAGE_2: Record<string, (b: ArrayBuffer) => Promise<ArrayBuffer>> = {
  deletePages: (b) => deletePages(b, [1]),
  splitPdfEach: async (b) => (await splitPdfEach(b, [0]))[0],
  splitPdfRanges: async (b) => (await splitPdfRanges(b, [[2, 2]]))[0],
  splitPdfGroups: async (b) => (await splitPdfGroups(b, [[0, 2]]))[0],
  mergePages: (b) => mergePages([b], [{ file: 0, page: 0 }, { file: 0, page: 2 }]),
};

type Chain = 'dest' | 'goto' | 'bead' | 'irt' | 'popup' | 'field' | 'field2';

/** 3 halaman; halaman 2 rahasia; halaman 1 merujuk halaman 2 lewat `chain`. */
async function crossPageFixture(chain: Chain) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const ctx = doc.context;
  const font = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }));
  const scan = ctx.register(ctx.flateStream('BT /F1 10 Tf 0 0 Td (P2-XOBJ-SCAN) Tj ET', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 50], Resources: { Font: { F1: font } } }));
  const bodies = ['(KEPT-P1) Tj', '(P2-SECRET-TEXT) Tj ET q /Xs Do Q BT', '(KEPT-P3) Tj'];
  const pages = bodies.map((body, i) => {
    const p = doc.addPage([300, 300]);
    p.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(`BT /F1 12 Tf 20 250 Td ${body} ET`)));
    p.node.set(PDFName.of('Resources'), ctx.obj(i === 1 ? { Font: { F1: font }, XObject: { Xs: scan } } : { Font: { F1: font } }));
    return p;
  });
  const [p1, p2, p3] = pages;
  const annot = (o: Record<string, unknown>) => ctx.register(ctx.obj({ Type: 'Annot', Rect: [10, 10, 60, 30], ...o } as never));
  if (chain === 'dest') p1.node.addAnnot(annot({ Subtype: 'Link', Dest: [p2.ref, 'Fit'] }));
  if (chain === 'goto') p1.node.addAnnot(annot({ Subtype: 'Link', A: { S: 'GoTo', D: [p2.ref, 'XYZ', null, null, null] } }));
  if (chain === 'bead') {
    const [b1, b2, b3, thread] = [ctx.nextRef(), ctx.nextRef(), ctx.nextRef(), ctx.nextRef()];
    ctx.assign(thread, ctx.obj({ Type: 'Thread', F: b1, I: { Title: PDFString.of('P2-THREAD-TITLE') } }));
    ctx.assign(b1, ctx.obj({ Type: 'Bead', T: thread, N: b2, V: b3, P: p1.ref, R: [0, 0, 100, 100] }));
    ctx.assign(b2, ctx.obj({ Type: 'Bead', N: b3, V: b1, P: p2.ref, R: [0, 0, 100, 100] }));
    ctx.assign(b3, ctx.obj({ Type: 'Bead', N: b1, V: b2, P: p3.ref, R: [0, 0, 100, 100] }));
    p1.node.set(PDFName.of('B'), ctx.obj([b1])); p2.node.set(PDFName.of('B'), ctx.obj([b2])); p3.node.set(PDFName.of('B'), ctx.obj([b3]));
  }
  if (chain === 'irt' || chain === 'popup') {
    const note = annot({ Subtype: 'Text', P: p2.ref, Contents: PDFString.of('P2-COMMENT-SECRET') });
    p2.node.addAnnot(note);
    if (chain === 'irt') p1.node.addAnnot(annot({ Subtype: 'Text', P: p1.ref, IRT: note, Contents: PDFString.of('setuju') }));
    else p1.node.addAnnot(annot({ Subtype: 'Popup', P: p1.ref, Parent: note }));
  }
  if (chain === 'field' || chain === 'field2') {
    const parent = ctx.nextRef();
    const ap = ctx.register(ctx.stream('/Tx BMC BT /F1 10 Tf 2 5 Td (P2-FIELD-AP-SECRET) Tj ET EMC', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 50, 20], Resources: { Font: { F1: font } } }));
    const w1 = annot({ Subtype: 'Widget', FT: 'Tx', T: PDFString.of('nama'), V: PDFString.of('Budi'), Parent: parent, P: p1.ref });
    let kid2: PDFRef;
    let w2: PDFRef;
    if (chain === 'field') {
      w2 = annot({ Subtype: 'Widget', FT: 'Tx', T: PDFString.of('nik'), V: PDFString.of('P2-FIELD-SECRET'), Parent: parent, P: p2.ref, AP: { N: ap } });
      kid2 = w2;
    } else {
      // Field terminal terpisah dari widget-nya: nilainya di field, bukan di anotasi halaman 2.
      kid2 = ctx.nextRef();
      w2 = annot({ Subtype: 'Widget', Parent: kid2, P: p2.ref, AP: { N: ap } });
      ctx.assign(kid2, ctx.obj({ FT: 'Tx', T: PDFString.of('nik'), V: PDFString.of('P2-FIELD-SECRET'), Parent: parent, Kids: [w2] }));
    }
    ctx.assign(parent, ctx.obj({ T: PDFString.of('pemohon'), Kids: [w1, kid2] }));
    p1.node.addAnnot(w1); p2.node.addAnnot(w2);
    doc.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [parent] }));
  }
  return (await doc.save()).buffer as ArrayBuffer;
}

/** Resources dipakai bersama (atau diwarisi dari /Pages) oleh 3 halaman; hanya halaman 2 memanggil isi rahasia. */
async function sharedResourcesFixture(mode: 'shared' | 'inherited', keptContent?: Uint8Array) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const ctx = doc.context;
  const font = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }));
  const form = (text: string) => ctx.register(ctx.flateStream(`BT /F1 10 Tf 0 0 Td (${text}) Tj ET`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 50], Resources: { Font: { F1: font } } }));
  const img = 'P2-IMG-BYTES';
  const res = ctx.register(ctx.obj({
    Font: { F1: font },
    XObject: { X1: form('P1-XOBJ-PUBLIC'), X2: form('P2-XOBJ-SECRET'), Im2: ctx.register(ctx.flateStream(img, { Type: 'XObject', Subtype: 'Image', Width: img.length, Height: 1, BitsPerComponent: 8, ColorSpace: 'DeviceGray' })) },
    Pattern: { P2: ctx.register(ctx.flateStream('BT /F1 6 Tf 0 0 Td (P2-PATTERN-SECRET) Tj ET', { Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, 100, 10], XStep: 100, YStep: 10, Resources: { Font: { F1: font } } })) },
    ExtGState: { GS2: { Type: 'ExtGState', SMask: { Type: 'Mask', S: 'Luminosity', G: ctx.register(ctx.flateStream('BT /F1 6 Tf 0 0 Td (P2-SMASK-SECRET) Tj ET', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 100, 10], Group: { S: 'Transparency', CS: 'DeviceGray' }, Resources: { Font: { F1: font } } })) } } },
    Properties: { MC2: { Type: 'OCG', Name: PDFString.of('P2-PROPS-SECRET') } },
  }));
  const kept1 = keptContent ? ctx.register(ctx.stream(keptContent, { Filter: 'FlateDecode' })) : ctx.register(ctx.flateStream('q /X1 Do Q BT /F1 12 Tf 20 250 Td (KEPT-P1) Tj ET'));
  const bodies = [kept1,
    ctx.register(ctx.flateStream('/OC /MC2 BDC /GS2 gs /Pattern cs /P2 scn 0 0 100 100 re f q /X2 Do Q q 100 0 0 100 0 0 cm /Im2 Do Q EMC')),
    ctx.register(ctx.flateStream('BT /F1 12 Tf 20 250 Td (KEPT-P3) Tj ET'))];
  for (const c of bodies) {
    const p = doc.addPage([300, 300]);
    p.node.set(PDFName.of('Contents'), c);
    if (mode === 'shared') p.node.set(PDFName.of('Resources'), res);
    else p.node.delete(PDFName.of('Resources'));
  }
  if (mode === 'inherited') doc.catalog.Pages().set(PDFName.of('Resources'), res);
  return (await doc.save()).buffer as ArrayBuffer;
}

describe('jalur buang-halaman tidak membawa isi halaman yang dibuang', () => {
  for (const chain of ['dest', 'goto', 'bead', 'irt', 'popup', 'field', 'field2'] as const) {
    for (const [op, run] of Object.entries(REMOVE_PAGE_2)) {
      it(`${chain} via ${op}`, async () => {
        const out = await dump(await run(await crossPageFixture(chain)));
        expect(out.text).not.toContain('P2-');
        expect(out.text).toContain('KEPT-');
        expect(out.pageDicts).toBe(out.pageCount);
        if (chain.startsWith('field') && op !== 'splitPdfRanges') expect(out.text).toContain('Budi');
      });
    }
  }

  for (const mode of ['shared', 'inherited'] as const) {
    for (const [op, run] of Object.entries(REMOVE_PAGE_2)) {
      it(`resources ${mode} via ${op}`, async () => {
        const out = await dump(await run(await sharedResourcesFixture(mode)));
        expect(out.text).not.toContain('P2-');
        if (op !== 'splitPdfRanges') expect(out.text).toContain('P1-XOBJ-PUBLIC');
      });
    }
  }

  it('menolak bila isi halaman yang dipertahankan tidak bisa didekode', async () => {
    const input = await sharedResourcesFixture('shared', new Uint8Array([0x78, 0x9c, 0xde, 0xad, 0xbe, 0xef, 0x00, 0x11]));
    await expect(deletePages(input, [1])).rejects.toThrow(/tidak bisa dibaca/);
  });
});

describe('redactPdf — resource bersama dan indeks', () => {
  const jpeg = (w: number, h: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]).buffer;

  it('tidak menyisakan Pattern/ExtGState/Properties/XObject halaman tersensor', async () => {
    const out = await PDFDocument.load(await redactPdf(await sharedResourcesFixture('shared'), new Map([[1, jpeg(600, 600)]]), 2));
    const text = out.context.enumerateIndirectObjects().map(([, o]) => (o instanceof PDFRawStream && !o.dict.toString().includes('/DCTDecode') ? o.dict.toString() + latin1(decodePDFRawStream(o).decode()) : o.toString())).join('\n');
    expect(text).not.toContain('P2-');
    expect(text).toContain('P1-XOBJ-PUBLIC');
    expect(out.getPageCount()).toBe(3);
  });

  it('menolak bila isi halaman lain rusak (dulu qpdf diam-diam melewatkan pemangkasan)', async () => {
    const input = await sharedResourcesFixture('shared', new Uint8Array([0x78, 0x9c, 0xde, 0xad, 0xbe, 0xef, 0x00, 0x11]));
    await expect(redactPdf(input, new Map([[1, jpeg(600, 600)]]), 2)).rejects.toThrow(/tidak bisa dibaca/);
  });

  it('menolak indeks halaman di luar dokumen', async () => {
    await expect(redactPdf(await sharedResourcesFixture('shared'), new Map([[3, jpeg(600, 600)]]), 2)).rejects.toThrow(/tidak ada di dokumen/);
  });
});

describe('assertSamePageOrder', () => {
  /** PDF mentah 3 halaman (A, B, C, opsional X) dengan page tree pilihan. */
  function raw(pagesObj: string, extra: string[] = []) {
    const content = (m: string) => { const c = `BT /F1 24 Tf 72 700 Td (${m}) Tj ET`; return `<< /Length ${c.length} >>\nstream\n${c}\nendstream`; };
    const leaf = (c: number, parent: number, typed = true) => `<< ${typed ? '/Type /Page ' : ''}/Parent ${parent} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${c} 0 R >>`;
    const objs = ['<< /Type /Catalog /Pages 2 0 R >>', pagesObj, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', content('PAGE-A'), content('PAGE-B'), content('PAGE-C'),
      leaf(4, 10), leaf(5, 10), leaf(6, 2), ...extra.map((e) => (e === 'leafX' ? leaf(11, 2, false) : e))];
    let s = '%PDF-1.7\n';
    const off: number[] = [];
    objs.forEach((o, i) => { off.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = s.length;
    s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new Uint8Array(new TextEncoder().encode(s)).buffer as ArrayBuffer;
  }
  const interNode = (count: number) => `<< /Type /Pages /Parent 2 0 R /Kids [7 0 R 8 0 R] /Count ${count} >>`;

  it('menerima page tree yang benar', async () => {
    await expect(assertSamePageOrder(raw('<< /Type /Pages /Kids [10 0 R 9 0 R] /Count 3 >>', [interNode(2)]))).resolves.toBeUndefined();
  });

  it('menolak /Count antara yang menyembunyikan halaman dari preview', async () => {
    // pdf.js: [A, C]; pdf-lib: [A, B, C] — Sensor halaman 2 preview dulu menempel di B dan C lolos sebagai teks.
    await expect(assertSamePageOrder(raw('<< /Type /Pages /Kids [10 0 R 9 0 R] /Count 2 >>', [interNode(1)]))).rejects.toThrow(PAGE_ORDER_MISMATCH);
  });

  it('menolak urutan berbeda dengan jumlah halaman sama', async () => {
    // pdf.js: [A, C, X]; pdf-lib: [A, B, C] — keduanya 3 halaman.
    const content = 'BT /F1 24 Tf 72 700 Td (PAGE-X) Tj ET';
    await expect(assertSamePageOrder(raw('<< /Type /Pages /Kids [10 0 R 9 0 R 12 0 R] /Count 3 >>', [interNode(1), `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, 'leafX'])))
      .rejects.toThrow(PAGE_ORDER_MISMATCH);
  });
});

import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString, StandardFonts, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { listFormFields, fillForm, flattenForm } from '../../src/engines/pdf-native';

async function makeFormPdf(): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();
  const name = form.createTextField('nama');
  name.setText('');
  name.addToPage(page);
  const agree = form.createCheckBox('setuju');
  agree.addToPage(page);
  const city = form.createDropdown('kota');
  city.addOptions(['Jakarta', 'Bandung', 'Surabaya']);
  city.select('Jakarta');
  city.addToPage(page);
  page.drawText('Formulir uji', { x: 40, y: 270, size: 16, font });
  return (await doc.save()).buffer as ArrayBuffer;
}

describe('form fill & flatten', () => {
  it('membaca field AcroForm', async () => {
    const fields = await listFormFields(await makeFormPdf());
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(byName.nama?.type).toBe('text');
    expect(byName.setuju?.type).toBe('checkbox');
    expect(byName.setuju?.value).toBe('tidak');
    expect(byName.kota?.options).toEqual(['Jakarta', 'Bandung', 'Surabaya']);
    expect(byName.kota?.value).toBe('Jakarta');
  });

  it('mengisi field lalu nilainya terbaca kembali', async () => {
    const pdf = await makeFormPdf();
    const out = await fillForm(pdf, { nama: 'Irwan', setuju: true, kota: 'Bandung' });
    const fields = Object.fromEntries((await listFormFields(out)).map((f) => [f.name, f]));
    expect(fields.nama.value).toBe('Irwan');
    expect(fields.setuju.value).toBe('ya');
    expect(fields.kota.value).toBe('Bandung');
  });

  it('mengabaikan field yang tidak ada tanpa error', async () => {
    const pdf = await makeFormPdf();
    const out = await fillForm(pdf, { 'tidak-ada': 'abc', nama: 'X' });
    const fields = Object.fromEntries((await listFormFields(out)).map((f) => [f.name, f]));
    expect(fields.nama.value).toBe('X');
  });

  it('flatten menghapus semua field menjadi konten statis', async () => {
    const filled = await fillForm(await makeFormPdf(), { nama: 'Irwan', setuju: true, kota: 'Surabaya' });
    const flat = await flattenForm(filled);
    // Semua field harus hilang — tidak ada lagi AcroForm.
    expect(await listFormFields(flat)).toEqual([]);
    // Dokumen hasil tetap PDF valid dengan jumlah halaman yang sama.
    const doc = await PDFDocument.load(flat);
    expect(doc.getPageCount()).toBe(1);
    // Nilai terbakar ke konten halaman — hex string "Irwan" (<497277616E>)
    // tersimpan di stream konten hasil ratakan qpdf (terkompresi FlateDecode).
    const hex = Buffer.from('Irwan').toString('hex').toUpperCase();
    const decoded = doc.context.enumerateIndirectObjects()
      .flatMap(([, obj]) => (obj instanceof PDFRawStream ? [Buffer.from(decodePDFRawStream(obj).getBytes(obj.contents.length * 64 + 4096)).toString('latin1')] : []))
      .join('\n');
    expect(decoded).toContain(hex);
  });

  it('flatten tidak menyisakan anotasi tanpa appearance yang masih hidup', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    const ctx = doc.context;
    const annot = (o: Record<string, unknown>) => ctx.register(ctx.obj({ Type: 'Annot', Rect: [10, 10, 120, 30], ...o } as never));
    const tx = annot({ Subtype: 'Widget', FT: 'Tx', T: PDFString.of('nik'), V: PDFString.of('NIK-DUMMY-0001'), DA: PDFString.of('/Helv 10 Tf 0 g'), P: page.ref });
    const btn = annot({ Subtype: 'Widget', FT: 'Btn', T: PDFString.of('setuju'), V: PDFName.of('Yes'), P: page.ref });
    const note = annot({ Subtype: 'Text', Contents: PDFString.of('CATATAN-RAHASIA'), T: PDFString.of('PENULIS-RAHASIA') });
    const square = annot({ Subtype: 'Square', Contents: PDFString.of('KOMENTAR-KOTAK'), T: PDFString.of('PENULIS-KOTAK'), AP: { N: ctx.register(ctx.stream('0 0 1 rg 0 0 50 20 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 50, 20] })) } });
    const popup = annot({ Subtype: 'Popup', Parent: square });
    const link = annot({ Subtype: 'Link', A: { S: 'URI', URI: PDFString.of('https://contoh.id') } });
    for (const a of [tx, btn, note, square, popup, link]) page.node.addAnnot(a);
    doc.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [tx, btn], DR: { Font: { Helv: ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' })) } } }));

    const flat = await PDFDocument.load(await flattenForm((await doc.save()).buffer as ArrayBuffer));
    const annots = flat.getPage(0).node.Annots()?.asArray().map((r) => flat.context.lookup(r)!.toString()) ?? [];
    expect(annots).toHaveLength(1);
    expect(annots[0]).toContain('/Link');
    const dump = flat.context.enumerateIndirectObjects().map(([, o]) => (o instanceof PDFRawStream ? new TextDecoder('latin1').decode(decodePDFRawStream(o).decode()) : o.toString())).join('\n');
    for (const leak of ['CATATAN-RAHASIA', 'PENULIS-RAHASIA', 'KOMENTAR-KOTAK', 'PENULIS-KOTAK', '/V ', '/AcroForm']) expect(dump).not.toContain(leak);
    // Nilai field teks tanpa appearance tetap terlihat — dibuatkan appearance lalu diratakan jadi konten.
    expect(dump).toContain('(NIK-DUMMY-0001) Tj');
  });

  it('flatten menolak PDF terenkripsi alih-alih melewatkan pembersihan', async () => {
    const { protectPdf } = await import('../../src/engines/pdf-native');
    const locked = await protectPdf(await makeFormPdf(), { password: 'rahasia' });
    await expect(flattenForm(locked)).rejects.toThrow(/terkunci/);
  });
});

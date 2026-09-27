import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
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
});

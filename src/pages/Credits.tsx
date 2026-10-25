import { tr } from '../lib/i18n';

const LIBS: [name: string, url: string, license: string, role: [string, string]][] = [
  ['pdf-lib', 'https://github.com/Hopding/pdf-lib', 'MIT', ['Menyusun & menyunting PDF', 'Building & editing PDFs']],
  ['@pdf-lib/fontkit', 'https://github.com/Hopding/fontkit', 'MIT', ['Font kustom TTF/OTF', 'Custom TTF/OTF fonts']],
  ['PDF.js', 'https://github.com/mozilla/pdf.js', 'Apache-2.0', ['Pratinjau, render & ekstrak teks', 'Preview, rendering & text extraction']],
  ['pdfstudio (qpdf WASM)', 'https://github.com/fayazara/pdfstudio', 'Apache-2.0', ['Enkripsi, buka proteksi & tulis ulang PDF', 'Encryption, unlocking & PDF rewriting']],
  ['LibreOffice (libreoffice-document-converter)', 'https://github.com/matbeedotcom/libreoffice-document-converter', 'MPL-2.0', ['Office ke PDF', 'Office to PDF']],
  ['tesseract.js', 'https://github.com/naptha/tesseract.js', 'Apache-2.0', ['OCR', 'OCR']],
  ['tessdata (@tesseract.js-data)', 'https://github.com/naptha/tessdata', 'MIT', ['Data bahasa OCR', 'OCR language data']],
  ['@imgly/background-removal', 'https://github.com/imgly/background-removal-js', 'AGPL-3.0', ['Hapus latar (ISNet)', 'Background removal (ISNet)']],
  ['rembg / U²-Net', 'https://github.com/danielgatis/rembg', 'Apache-2.0', ['Model hapus latar u2netp', 'u2netp background-removal model']],
  ['ONNX Runtime Web', 'https://github.com/microsoft/onnxruntime', 'MIT', ['Menjalankan model AI di browser', 'Running AI models in the browser']],
  ['fflate', 'https://github.com/101arrowz/fflate', 'MIT', ['Arsip ZIP', 'ZIP archives']],
  ['React & React Router', 'https://github.com/facebook/react', 'MIT', ['Antarmuka', 'User interface']],
  ['DM Sans, DM Mono, Playfair Display, Nunito', 'https://fonts.google.com', 'OFL-1.1', ['Font', 'Fonts']],
];

export function Credits() {
  return <div className="page prose">
    <div className="eyebrow">CREDITS / OPEN SOURCE</div>
    <h1>{tr('Dibangun di atas', 'Built on the')}<br /><em>{tr('kerja banyak orang.', 'work of many.')}</em></h1>
    <p>{tr('PrivaPDF dibuat oleh', 'PrivaPDF is made by')} <a href="https://github.com/wannet2213" target="_blank" rel="noreferrer">wannet2213</a>. {tr('Kode sumbernya terbuka di', 'Its source code is open at')} <a href="https://github.com/wannet2213/privapdf" target="_blank" rel="noreferrer">github.com/wannet2213/privapdf</a> {tr('dengan lisensi AGPL-3.0-or-later.', 'under the AGPL-3.0-or-later license.')}</p>
    <h2>{tr('Proyek open source yang dipakai', 'Open source projects used')}</h2>
    <ul>{LIBS.map(([name, url, license, role]) => <li key={name}><a href={url} target="_blank" rel="noreferrer">{name}</a> ({license}) — {tr(...role)}</li>)}</ul>
    <p>{tr('Terima kasih kepada para pengelola dan kontributor proyek-proyek di atas.', 'Thanks to the maintainers and contributors of the projects above.')}</p>
  </div>;
}

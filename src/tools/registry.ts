export type Tool = { id: string; label: string; description: string; accept?: string; capability?: boolean };
const PDF = 'application/pdf,.pdf';
const IMG = 'image/png,image/jpeg,.png,.jpg,.jpeg';
const IMG_TOOLKIT = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';
const OFFICE = '.doc,.docx,.xls,.xlsx,.odt,.ods,.odp,.ppt,.pptx,.rtf,.csv,.html,.htm,application/msword,application/vnd.ms-excel,application/vnd.ms-powerpoint,application/vnd.oasis.opendocument.text,application/vnd.oasis.opendocument.spreadsheet,application/vnd.oasis.opendocument.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/csv,text/html';

export const tools: Tool[] = [
  { id: 'merge', label: 'Gabungkan PDF', description: 'Gabungkan beberapa PDF, atur urutan & hapus halaman secara visual.', accept: PDF },
  { id: 'split', label: 'Pisahkan PDF', description: 'Ekstrak halaman pilihan sebagai PDF baru.', accept: PDF },
  { id: 'delete-pages', label: 'Hapus halaman', description: 'Buang halaman yang tidak diinginkan dari PDF.', accept: PDF },
  { id: 'reorder-pages', label: 'Urutkan ulang', description: 'Susun ulang urutan halaman PDF.', accept: PDF },
  { id: 'rotate', label: 'Putar halaman', description: 'Putar semua halaman PDF.', accept: PDF },
  { id: 'page-numbers', label: 'Nomor halaman', description: 'Tambahkan nomor halaman otomatis ke PDF.', accept: PDF },
  { id: 'watermark', label: 'Tanda air', description: 'Tambahkan tanda air teks atau gambar transparan ke semua halaman.', accept: PDF },
  { id: 'n-up', label: 'Halaman per lembar', description: 'Cetak 2 atau 4 halaman dalam satu lembar, atau susun jadi buklet lipat.', accept: PDF },
  { id: 'crop', label: 'Potong halaman', description: 'Kustom margin untuk memotong semua halaman PDF.', accept: PDF },
  { id: 'compress', label: 'Kompres PDF', description: 'Perkecil ukuran PDF. Tingkat Sedang/Kuat merender ulang halaman jadi gambar, efektif untuk hasil scan.', accept: PDF },
  { id: 'unlock', label: 'Hapus proteksi', description: 'Buka PDF yang terkunci atau terenkripsi, dengan password atau hapus restriction.', accept: PDF },
  { id: 'protect', label: 'Beri password', description: 'Enkripsi PDF dengan password (AES-256) agar hanya bisa dibuka oleh pemegang password.', accept: PDF },
  { id: 'metadata', label: 'Edit metadata', description: 'Ubah judul, penulis, subjek, dan kata kunci PDF.', accept: PDF },
  { id: 'redact', label: 'Sensor PDF', description: 'Tutup permanen data sensitif (NIK, nomor rekening, alamat) dengan kotak hitam. Teks di bawahnya benar-benar dihapus.', accept: PDF },
  { id: 'sanitize', label: 'Bersihkan PDF', description: 'Hapus data tersembunyi sebelum berbagi: info penulis, metadata, lampiran, JavaScript, dan riwayat revisi.', accept: PDF },
  { id: 'pdf-to-image', label: 'PDF ke gambar', description: 'Konversi setiap halaman PDF menjadi PNG atau JPEG.', accept: PDF },
  { id: 'ocr', label: 'OCR PDF hasil scan', description: 'Kenali teks di PDF hasil scan agar bisa dicari dan disalin. Bahasa Indonesia & Inggris, diproses di perangkatmu.', accept: PDF },
  { id: 'extract-text', label: 'Ekstrak teks', description: 'Ambil semua teks dari PDF dan simpan sebagai file teks.', accept: PDF },
  { id: 'sign', label: 'Tanda tangan / stempel', description: 'Gambar tanda tangan atau unggah gambar stempel, lalu tempel di halaman mana pun.', accept: PDF },
  { id: 'fill-form', label: 'Isi formulir', description: 'Isi field formulir PDF (teks, checkbox, dropdown) langsung dari browser.', accept: PDF },
  { id: 'flatten', label: 'Ratakan (flatten)', description: 'Kunci formulir dan anotasi menjadi konten statis yang tidak bisa diubah.', accept: PDF },
  { id: 'image-to-pdf', label: 'Gambar ke PDF', description: 'Buat PDF dari PNG atau JPEG.', accept: IMG },
  { id: 'image-toolkit', label: 'Toolkit gambar', description: 'Kompres, resize massal, dan konversi PNG/JPEG/WebP. Re-encode menghapus EXIF (GPS, info kamera).', accept: IMG_TOOLKIT },
  { id: 'image-watermark', label: 'Tanda air gambar', description: 'Tambahkan tanda air teks atau logo ke foto (PNG/JPEG/WebP), satu atau banyak sekaligus.', accept: IMG_TOOLKIT },
  { id: 'remove-bg', label: 'Hapus latar', description: 'Buat latar warna solid jadi transparan (foto produk, logo). Pilih warna + toleransi, hasil PNG.', accept: IMG },
  { id: 'office-to-pdf', label: 'Office ke PDF', description: 'Konversi Word, Excel, PowerPoint, ODT/ODS/ODP, RTF, CSV, atau HTML secara lokal.', accept: OFFICE },
];

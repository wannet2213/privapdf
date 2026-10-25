import { useParams, Link } from 'react-router-dom';
import { tools } from '../tools/registry';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { readSessionFiles, clearSession, type SessionFile } from '../lib/file-session';
import { PDFDocument } from 'pdf-lib';
import { runJob } from '../engine/engine-client';
import type { Phase, SplitOptions } from '../engine/types';
import { filterSupportedFiles, validateCount } from '../lib/validation';
import { uid } from '../lib/uid';
import { createZip } from '../lib/zip';
import { SplitPanel } from '../components/SplitPanel';
import { PageSelectPanel } from '../components/PageSelectPanel';
import { ReorderPanel } from '../components/ReorderPanel';
import { AnnotatePanel } from '../components/AnnotatePanel';
import { CropPanel } from '../components/CropPanel';
import { RotatePanel } from '../components/RotatePanel';
import { MergePanel, type PageRef } from '../components/MergePanel';
import { ToolOptionsForm, type Field } from '../components/ToolOptionsForm';
import { pdfToImages, extractText, assertSamePageOrder } from '../lib/pdf-client';
import { stampImage, jpegsToPdf, addTextLayer, type StampOptions } from '../engines/pdf-native';
import { SignPanel } from '../components/SignPanel';
import { FormFillPanel } from '../components/FormFillPanel';
import { ImageToolkitPanel, type ImageOutput } from '../components/ImageToolkitPanel';
import { RemoveBgPanel } from '../components/RemoveBgPanel';
import { RedactPanel, type Redactions } from '../components/RedactPanel';
import { EditTextPanel } from '../components/EditTextPanel';
import type { TextEdit } from '../engines/edit-text';
import { verifyTextEdits } from '../lib/edit-verify';
import { preloadOfficeConverter } from '../engines/office-native';
import { locale, tr } from '../lib/i18n';

const STALL_AFTER_MS = 20000;
const STALL_HINT = tr(' — tidak ada kemajuan ±20 detik. Bila terus berhenti, muat ulang halaman (refresh) lalu ulangi proses.', ' — no progress for ±20 seconds. If it stays stuck, reload the page (refresh) and run it again.');

const METADATA_FIELDS: Field[] = [
  { name: 'title', label: tr('Judul', 'Title'), type: 'text', placeholder: tr('Judul dokumen', 'Document title') },
  { name: 'author', label: tr('Penulis', 'Author'), type: 'text', placeholder: tr('Nama penulis', 'Author name') },
  { name: 'subject', label: tr('Subjek', 'Subject'), type: 'text', placeholder: tr('Topik dokumen', 'Document topic') },
  { name: 'keywords', label: tr('Kata kunci', 'Keywords'), type: 'text', placeholder: tr('pisahkan dengan koma', 'comma separated') },
  { name: 'creator', label: tr('Pembuat', 'Creator'), type: 'text', placeholder: tr('Aplikasi pembuat', 'Creating application') },
];

const FILE_COLORS = ['#E5322D', '#2FA36B', '#3B6FE0', '#8B5CF6', '#E88C30', '#0E9F9F'];

const UploadIcon = () => (
  <svg viewBox="0 0 24 24" width="46" height="46" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 15.5V5" /><path d="m7.5 9.5 4.5-4.5 4.5 4.5" /><path d="M4 16.5V19a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-2.5" />
  </svg>
);

const PDF_TO_IMAGE_FIELDS: Field[] = [
  { name: 'format', label: 'Format', type: 'select', default: 'png', options: [{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPEG' }] },
  { name: 'scale', label: tr('Resolusi', 'Resolution'), type: 'select', default: '2', options: [{ value: '1', label: tr('Standar (1x)', 'Standard (1x)') }, { value: '2', label: tr('Tinggi (2x)', 'High (2x)') }, { value: '3', label: tr('Maksimum (3x)', 'Maximum (3x)') }] },
];

const COMPRESS_FIELDS: Field[] = [
  { name: 'level', label: tr('Tingkat kompresi', 'Compression level'), type: 'select', default: 'ringan', options: [
    { value: 'ringan', label: tr('Ringan: rapikan struktur, teks tetap bisa dipilih', 'Light: tidy the structure, text stays selectable') },
    { value: 'sedang', label: tr('Sedang: halaman jadi gambar 144 dpi', 'Medium: pages become 144 dpi images') },
    { value: 'kuat', label: tr('Kuat: halaman jadi gambar 108 dpi, ukuran terkecil', 'Strong: pages become 108 dpi images, smallest size') },
  ] },
];

// Render ulang halaman jadi JPEG; skala 1 = 72 dpi.
const RASTER_LEVELS: Record<string, { scale: number; quality: number }> = {
  sedang: { scale: 2, quality: 0.7 },
  kuat: { scale: 1.5, quality: 0.5 },
};

const NUP_FIELDS: Field[] = [
  { name: 'layout', label: tr('Tata letak', 'Layout'), type: 'select', default: '2', options: [
    { value: '2', label: tr('2 halaman per lembar', '2 pages per sheet') },
    { value: '4', label: tr('4 halaman per lembar', '4 pages per sheet') },
    { value: 'booklet', label: tr('Buklet (lipat tengah)', 'Booklet (center fold)') },
  ] },
];

// Halaman tersensor dirender 144 dpi.
const REDACT_SCALE = 2;

const formatSize = (n: number) => n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toLocaleString(locale, { maximumFractionDigits: 1 })} MB`;

const SIMPLE_BUTTON_TOOLS = new Set(['image-to-pdf', 'office-to-pdf', 'sanitize']);

const IS_TOUCH = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

export function ToolWorkspace() {
  const { toolId } = useParams();
  const tool = tools.find((item) => item.id === toolId);
  const ref = useRef<HTMLInputElement>(null);
  const addMoreRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<SessionFile[]>([]);
  const filesRef = useRef<SessionFile[]>([]);
  const [status, setStatus] = useState(tr('Pilih file dari perangkatmu.', 'Choose files from your device.'));
  const [phase, setPhase] = useState<Phase>();
  const [pageCount, setPageCount] = useState(0);
  const [reorderOrder, setReorderOrder] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [stalled, setStalled] = useState(false);
  const lastProgressRef = useRef(0);
  const [dragOver, setDragOver] = useState(false);
  const [dropRejected, setDropRejected] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [protectPassword, setProtectPassword] = useState('');
  const [protectOwner, setProtectOwner] = useState('');
  useEffect(() => { filesRef.current = files; }, [files]);
  useEffect(() => { const cleanup = () => clearSession(filesRef.current); window.addEventListener('pagehide', cleanup); window.addEventListener('beforeunload', cleanup); return () => { window.removeEventListener('pagehide', cleanup); window.removeEventListener('beforeunload', cleanup); cleanup(); }; }, []);

  // Identitas stabil untuk prop MergePanel — tanpa ini parent re-render akan me-reload dokumen dan mereset urutan user.
  // Dipanggil sebelum early return di bawah: jumlah hook harus sama di setiap render.
  const mergeFiles = useMemo(() => files.map((f) => ({ bytes: f.bytes, name: f.name })), [files]);

  if (!tool) return <div className="page"><h1>{tr('Tool tidak ditemukan.', 'Tool not found.')}</h1></div>;

  const singleFile = toolId !== 'merge' && toolId !== 'image-toolkit' && toolId !== 'image-watermark';
  const needsPageCount = toolId === 'split' || toolId === 'delete-pages' || toolId === 'reorder-pages' || toolId === 'rotate';
  // Alat yang mengirim indeks halaman dari preview (pdf.js) ke mesin (pdf-lib): keduanya harus sepakat soal halaman.
  const pageIndexed = needsPageCount || ['redact', 'merge', 'edit-text', 'crop', 'sign', 'ocr'].includes(toolId ?? '');
  const checkPageOrder = async (list: SessionFile[]) => {
    if (!pageIndexed) return;
    try { for (const f of list) await assertSamePageOrder(f.bytes); } catch (e) { clearSession(list); throw e; }
  };

  const choose = async (list: FileList | null) => {
    if (!list) return;
    setDropRejected(false);
    // Drop bisa membawa banyak file walau input-nya single — alat satu-file hanya ambil yang pertama.
    const accepted = filterSupportedFiles([...list], tool.accept).slice(0, singleFile ? 1 : undefined);
    if (!accepted.length) { setDropRejected(true); setStatus(tr('Format file tidak didukung.', 'File format not supported.')); return; }
    // Mulai unduh aset LibreOffice WASM (~74 MB setelah gzip) sekarang, berbarengan
    // dengan pembacaan berkas — bukan menunggu tombol konversi ditekan.
    if (toolId === 'office-to-pdf') preloadOfficeConverter();
    setPhase(undefined);
    setStatus(tr('Membaca file…', 'Reading files…'));
    try {
      const next = await readSessionFiles(accepted);
      await checkPageOrder(next);
      setFiles(next);
      setPageCount(0);
      setStatus(tr('File siap. Jalankan proses atau atur opsi.', 'Files ready. Run the process or adjust the options.'));
      if (needsPageCount && next[0]) {
        const doc = await PDFDocument.load(next[0].bytes);
        const count = doc.getPageCount();
        setPageCount(count);
        if (toolId === 'reorder-pages') setReorderOrder(Array.from({ length: count }, (_, i) => i));
      }
    } catch (e) { setStatus(e instanceof Error ? e.message : tr('File tidak valid.', 'Invalid file.')); }
  };

  const addFiles = async (list: FileList | null) => {
    if (!list || !list.length) return;
    const accepted = filterSupportedFiles([...list], tool.accept);
    if (!accepted.length) { setStatus(tr('Format file tidak didukung.', 'File format not supported.')); return; }
    setStatus(tr('Menambahkan file…', 'Adding files…'));
    try {
      // Batas 10 file / 120 MB berlaku untuk seluruh sesi, bukan per batch tambahan.
      validateCount([...files, ...accepted]);
      const more = await readSessionFiles(accepted);
      await checkPageOrder(more);
      setFiles((prev) => [...prev, ...more]);
      setStatus(tr(`${more.length} file ditambahkan. Total ${files.length + more.length} file.`, `${more.length} file(s) added. ${files.length + more.length} file(s) in total.`));
    } catch (e) { setStatus(e instanceof Error ? e.message : tr('File tidak valid.', 'Invalid file.')); }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => {
      const next = prev.filter((_, i) => i !== index);
      setStatus(next.length ? tr(`${next.length} file tersisa.`, `${next.length} file(s) left.`) : tr('Pilih file dari perangkatmu.', 'Choose files from your device.'));
      return next;
    });
  };

  const downloadBlobs = (blobs: Blob[], names: string[], mime: string) => {
    blobs.forEach((blob, i) => {
      const url = URL.createObjectURL(new Blob([blob], { type: mime }));
      const a = document.createElement('a');
      a.href = url;
      a.download = names[i] || `privapdf-output-${i + 1}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  };

  const runWorker = async (operation: string, inputs: ArrayBuffer[], options?: Record<string, unknown>, mime = 'application/pdf', defaultExt = 'pdf', zipOutput = false) => {
    setBusy(true); setPhase(undefined); setStatus(tr('Memproses…', 'Processing…'));
    setStalled(false);
    lastProgressRef.current = Date.now();
    // Pemantau kemajuan: bila tidak ada event progres selama STALL_AFTER_MS,
    // tampilkan petunjuk muat-ulang di baris status (pernah terjadi: inisialisasi
    // WASM menggantung tanpa pesan apa pun di konteks tanpa SharedArrayBuffer).
    const stallTimer = window.setInterval(() => {
      if (Date.now() - lastProgressRef.current >= STALL_AFTER_MS) setStalled(true);
    }, 5000);
    try {
      let outputNames: string[] | undefined;
      const outputs = await runJob({ jobId: uid(), operation: operation as never, inputs, options } as never, (event: { type: string; phase?: Phase; progress?: number; outputNames?: string[]; status?: string }) => {
        setPhase(event.phase); outputNames = event.outputNames;
        lastProgressRef.current = Date.now();
        setStalled(false);
        if (event.type === 'progress') setStatus(event.status ?? `${event.phase ?? tr('Memproses', 'Processing')} · ${Math.round((event.progress || 0) * 100)}%`);
      });
      const names = outputNames?.length ? outputNames : outputs.map((_, i) => `${files[0]?.name?.replace(/\.[^.]+$/, '') || 'document'}-${i + 1}.${defaultExt}`);
      if (zipOutput && outputs.length > 1) {
        setStatus(tr('Mengemas ZIP…', 'Packing ZIP…'));
        const zipName = `${files[0]?.name?.replace(/\.[^.]+$/, '') || 'document'}.zip`;
        downloadBlobs([await createZip(outputs.map((b, i) => ({ name: names[i], bytes: b })))], [zipName], 'application/zip');
        setStatus(tr(`Selesai. ${outputs.length} file dikemas dalam ${zipName}.`, `Done. ${outputs.length} files packed into ${zipName}.`));
      } else {
        downloadBlobs(outputs.map((b) => new Blob([b])), names, mime);
        setStatus(tr(`Selesai. ${outputs.length} file telah diunduh.`, `Done. ${outputs.length} file(s) downloaded.`));
      }
    } catch (e) { setStatus(e instanceof Error ? e.message : tr('Pemrosesan gagal.', 'Processing failed.')); }
    clearInterval(stallTimer);
    setBusy(false); setStalled(false);
  };

  const handleSplit = (options: SplitOptions) => runWorker('split', [files[0].bytes], { ...options }, 'application/pdf', 'pdf', options.asZip === true);
  const handleDeletePages = (indices: number[]) => runWorker('delete-pages', [files[0].bytes], { indices });
  const handleReorder = () => runWorker('reorder-pages', [files[0].bytes], { order: reorderOrder });
  const handleAnnotate = (opts: Record<string, unknown>) => runWorker(toolId!, [files[0].bytes], opts);
  const handleCrop = (opts: Record<string, unknown>) => runWorker('crop', [files[0].bytes], opts);
  const handleMergePages = (refs: PageRef[]) => runWorker('merge-pages', files.map((f) => f.bytes), { refs });

  const handleFormTool = (values: Record<string, string | number>) => {
    const opts: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (typeof v === 'string' && v.trim()) opts[k] = v;
      else if (typeof v === 'number') opts[k] = v;
    }
    runWorker(toolId!, [files[0].bytes], opts);
  };

  const renderPdfToImages = async (values: Record<string, string | number>) => {
    const format = values.format as 'png' | 'jpeg';
    const scale = Number(values.scale) || 2;
    setBusy(true); setStatus(tr('Merender halaman…', 'Rendering pages…'));
    try {
      const blobs = await pdfToImages(files[0].bytes, { format, scale }, (cur, total) => setStatus(tr(`Merender halaman ${cur}/${total}…`, `Rendering page ${cur}/${total}…`)));
      const names = blobs.map((_, i) => `${files[0].name.replace(/\.pdf$/i, '')}-${tr('hal', 'page')}-${i + 1}.${format === 'jpeg' ? 'jpg' : 'png'}`);
      return { blobs, names, format };
    } catch (e) {
      setStatus(e instanceof Error ? e.message : tr('Render gagal.', 'Rendering failed.'));
      setBusy(false);
      return null;
    }
  };

  const handlePdfToImage = async (values: Record<string, string | number>) => {
    const out = await renderPdfToImages(values);
    if (!out) return;
    downloadBlobs(out.blobs, out.names, `image/${out.format}`);
    setStatus(tr(`Selesai. ${out.blobs.length} gambar telah diunduh.`, `Done. ${out.blobs.length} image(s) downloaded.`));
    setBusy(false);
  };

  const handlePdfToImageZip = async (values: Record<string, string | number>) => {
    const out = await renderPdfToImages(values);
    if (!out) return;
    try {
      setStatus(tr('Mengemas ZIP…', 'Packing ZIP…'));
      const bytes = await Promise.all(out.blobs.map((b) => b.arrayBuffer()));
      const zip = await createZip(bytes.map((b, i) => ({ name: out.names[i], bytes: b })));
      const zipName = `${files[0].name.replace(/\.pdf$/i, '')}-${tr('gambar', 'images')}.zip`;
      downloadBlobs([zip], [zipName], 'application/zip');
      setStatus(tr(`Selesai. ${out.blobs.length} gambar dikemas dalam ${zipName}.`, `Done. ${out.blobs.length} images packed into ${zipName}.`));
    } catch (e) { setStatus(e instanceof Error ? e.message : tr('Gagal mengemas ZIP.', 'Failed to pack ZIP.')); }
    setBusy(false);
  };

  const handleExtractText = async () => {
    setBusy(true); setStatus(tr('Mengekstrak teks…', 'Extracting text…'));
    try {
      const result = await extractText(files[0].bytes, (cur, total) => setStatus(tr(`Mengekstrak halaman ${cur}/${total}…`, `Extracting page ${cur}/${total}…`)));
      const blob = new Blob([result.text], { type: 'text/plain;charset=utf-8' });
      const names = [`${files[0].name.replace(/\.pdf$/i, '')}.txt`];
      downloadBlobs([blob], names, 'text/plain');
      setStatus(tr(`Selesai. ${result.pages} halaman diproses, ${result.text.length} karakter diekstrak.`, `Done. ${result.pages} page(s) processed, ${result.text.length} characters extracted.`));
    } catch (e) { setStatus(e instanceof Error ? e.message : tr('Ekstraksi gagal.', 'Extraction failed.')); }
    setBusy(false);
  };

  const handleSign = async (opts: StampOptions) => {
    setBusy(true); setStatus(tr('Menempelkan tanda tangan…', 'Placing signature…'));
    try {
      const out = await stampImage(files[0].bytes, opts);
      downloadBlobs([new Blob([out])], [`${files[0].name.replace(/\.pdf$/i, '')}-${tr('ditandatangani', 'signed')}.pdf`], 'application/pdf');
      setStatus(tr('Selesai. PDF bertanda tangan telah diunduh.', 'Done. Signed PDF downloaded.'));
    } catch (e) { setStatus(e instanceof Error ? e.message : tr('Gagal menempelkan tanda tangan.', 'Failed to place signature.')); }
    setBusy(false);
  };

  const downloadBuffer = (out: ArrayBuffer, suffix: string) => {
    downloadBlobs([new Blob([out])], [`${files[0].name.replace(/\.pdf$/i, '')}-${suffix}.pdf`], 'application/pdf');
    setStatus(tr('Selesai. PDF telah diunduh.', 'Done. PDF downloaded.'));
  };

  const handleFormDownload = (out: ArrayBuffer) => {
    downloadBlobs([new Blob([out])], [`${files[0].name.replace(/\.pdf$/i, '')}-${tr('terisi', 'filled')}.pdf`], 'application/pdf');
    setStatus(tr('Selesai. PDF formulir terisi telah diunduh.', 'Done. Filled form PDF downloaded.'));
  };

  const handleCompress = async (values: Record<string, string | number>) => {
    const raster = RASTER_LEVELS[values.level];
    if (!raster) { runWorker('compress', [files[0].bytes]); return; }
    const input = files[0].bytes;
    setBusy(true); setStatus(tr('Merender halaman…', 'Rendering pages…'));
    try {
      const blobs = await pdfToImages(input, { format: 'jpeg', ...raster }, (cur, total) => setStatus(tr(`Merender halaman ${cur}/${total}…`, `Rendering page ${cur}/${total}…`)));
      setStatus(tr('Menyusun PDF…', 'Building PDF…'));
      const out = await jpegsToPdf(await Promise.all(blobs.map((b) => b.arrayBuffer())), raster.scale);
      const sizes = `${formatSize(input.byteLength)} → ${formatSize(out.byteLength)}`;
      // PDF teks/vektor justru membengkak saat dijadikan gambar — jangan unduhkan hasil yang lebih besar.
      if (out.byteLength >= input.byteLength) setStatus(tr(`Hasil tidak lebih kecil (${sizes}), jadi tidak diunduh. PDF ini kebanyakan teks/vektor, pakai tingkat Ringan.`, `The result is not smaller (${sizes}), so it was not downloaded. This PDF is mostly text/vector, use the Light level.`));
      else {
        downloadBuffer(out, tr('kompres', 'compressed'));
        setStatus(tr('Selesai.', 'Done.') + ` ${sizes} (−${Math.round((1 - out.byteLength / input.byteLength) * 100)}%).`);
      }
    } catch (e) { setStatus(e instanceof Error ? e.message : tr('Kompresi gagal.', 'Compression failed.')); }
    setBusy(false);
  };

  const handleRedact = async (boxes: Redactions) => {
    const pages = Object.keys(boxes).map(Number).filter((i) => boxes[i].length).sort((a, b) => a - b);
    setBusy(true); setStatus(tr('Merender halaman…', 'Rendering pages…'));
    try {
      const blobs = await pdfToImages(files[0].bytes, {
        format: 'jpeg', scale: REDACT_SCALE, quality: 0.85, pages,
        // Lebihkan 0,5 pt (1 px) di tiap sisi agar piksel tepi yang ter-antialias ikut tertutup penuh.
        draw: (ctx, page) => { ctx.fillStyle = '#000'; for (const b of boxes[page]) ctx.fillRect(b.x - 0.5, b.y - 0.5, b.w + 1, b.h + 1); },
      }, (cur, total) => setStatus(tr(`Merender halaman ${cur}/${total}…`, `Rendering page ${cur}/${total}…`)));
      const jpgs = await Promise.all(blobs.map((b) => b.arrayBuffer()));
      setBusy(false);
      // Penyusunan butuh qpdf (WASM) — hanya boleh di worker; CSP halaman memblokir kompilasi WASM.
      await runWorker('redact', [files[0].bytes, ...jpgs], { pages, scale: REDACT_SCALE, filename: files[0].name });
    } catch (e) { setStatus(e instanceof Error ? e.message : tr('Sensor gagal.', 'Redaction failed.')); setBusy(false); }
  };

  const handleOcr = async (asText: boolean) => {
    setBusy(true);
    try {
      // tesseract.js dimuat hanya saat dipakai — tidak membebani bundel utama.
      const { ocrPdf } = await import('../lib/ocr');
      const pages = await ocrPdf(files[0].bytes, setStatus);
      const recognized = pages.filter((p) => !p.skipped).length;
      const skippedNote = pages.length > recognized ? tr(`, ${pages.length - recognized} halaman sudah berisi teks dan dilewati`, `, ${pages.length - recognized} page(s) already had text and were skipped`) : '';
      if (asText) {
        downloadBlobs([new Blob([pages.map((p) => p.text).join('\n\n')], { type: 'text/plain;charset=utf-8' })], [`${files[0].name.replace(/\.pdf$/i, '')}.txt`], 'text/plain');
        setStatus(tr(`Selesai. Teks ${pages.length} halaman telah diunduh.`, `Done. Text of ${pages.length} page(s) downloaded.`));
      } else if (!recognized) {
        setStatus(tr('Semua halaman sudah berisi teks, tidak ada yang perlu di-OCR.', 'Every page already has text, nothing to OCR.'));
      } else {
        setStatus(tr('Menyusun PDF…', 'Building PDF…'));
        downloadBuffer(await addTextLayer(files[0].bytes, pages.map((p) => p.words)), 'ocr');
        setStatus(tr(`Selesai. ${recognized} halaman dikenali${skippedNote}.`, `Done. ${recognized} page(s) recognized${skippedNote}.`));
      }
    } catch (e) { setStatus(e instanceof Error ? e.message : tr('OCR gagal.', 'OCR failed.')); }
    setBusy(false);
  };

  const handleEditText = async (edits: TextEdit[]) => {
    setBusy(true); setPhase(undefined); setStatus(tr('Menyunting teks…', 'Editing text…'));
    try {
      let names: string[] | undefined;
      const [out] = await runJob({ jobId: uid(), operation: 'edit-text', inputs: [files[0].bytes], options: { edits, filename: files[0].name } }, (event) => { names = event.outputNames ?? names; });
      setStatus(tr('Memeriksa hasil…', 'Checking the result…'));
      // Diperiksa dari apa yang benar-benar bisa diekstrak pdf.js, bukan dari asumsi engine.
      const problems = await verifyTextEdits(files[0].bytes, out, edits);
      downloadBlobs([new Blob([out])], [names?.[0] ?? `${files[0].name.replace(/\.pdf$/i, '')}-${tr('diedit', 'edited')}.pdf`], 'application/pdf');
      setStatus(problems.length ? tr(`PDF diunduh, tapi perlu dicek. ${problems.join(' ')}`, `PDF downloaded, but please check it. ${problems.join(' ')}`) : tr(`Selesai. ${edits.length} perubahan diterapkan; teks lama sudah tidak ada di file.`, `Done. ${edits.length} change(s) applied; the old text is gone from the file.`));
    } catch (e) { setStatus(e instanceof Error ? e.message : tr('Gagal menyunting teks.', 'Failed to edit text.')); }
    setBusy(false);
  };

  const handleFlatten = () => runWorker('flatten', [files[0].bytes], { filename: files[0]?.name });

  const handleImageToolkit = async (items: ImageOutput[]) => {
    setBusy(true);
    try {
      if (items.length === 1) {
        downloadBlobs([items[0].blob], [items[0].name], items[0].blob.type);
        setStatus(tr(`Selesai. ${items[0].name} telah diunduh.`, `Done. ${items[0].name} downloaded.`));
      } else {
        setStatus(tr('Mengemas ZIP…', 'Packing ZIP…'));
        const bytes = await Promise.all(items.map((i) => i.blob.arrayBuffer()));
        const zip = await createZip(bytes.map((b, i) => ({ name: items[i].name, bytes: b })));
        const zipName = tr('privapdf-gambar.zip', 'privapdf-images.zip');
        downloadBlobs([zip], [zipName], 'application/zip');
        setStatus(tr(`Selesai. ${items.length} gambar dikemas dalam ${zipName}.`, `Done. ${items.length} images packed into ${zipName}.`));
      }
    } catch (e) { setStatus(e instanceof Error ? e.message : tr('Gagal mengemas ZIP.', 'Failed to pack ZIP.')); }
    setBusy(false);
  };

  const handleRemoveBg = (blob: Blob, background: string | null) => {
    downloadBlobs([blob], [`${files[0].name.replace(/\.[^.]+$/, '')}-${background ? tr('latar', 'background') : tr('transparan', 'transparent')}.png`], 'image/png');
    setStatus(background ? tr(`Selesai. PNG berlatar ${background} telah diunduh.`, `Done. PNG with ${background} background downloaded.`) : tr('Selesai. PNG transparan telah diunduh.', 'Done. Transparent PNG downloaded.'));
  };

  const handleUnlock = () => runWorker('unlock', [files[0].bytes], unlockPassword.trim() ? { password: unlockPassword } : undefined);

  const handleProtect = () => {
    if (!protectPassword.trim()) { setStatus(tr('Password buka wajib diisi.', 'An open password is required.')); return; }
    const opts: Record<string, unknown> = { password: protectPassword, filename: files[0]?.name };
    if (protectOwner.trim()) opts.ownerPassword = protectOwner;
    runWorker('protect', [files[0].bytes], opts);
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => { event.preventDefault(); setDragOver(false); choose(event.dataTransfer.files); };

  return <div className="workspace page">
    <Link className="back" to="/tools">← {tr('semua tools', 'all tools')}</Link>
    <div className="eyebrow">WORKSPACE / {toolId?.toUpperCase()}</div>
    <h1>{tool.label}</h1>
    <p className="lead">{tool.description}</p>
    <button className={`drop compact ${dragOver ? 'is-drag-over' : ''} ${dropRejected ? 'drop-rejected' : ''}`} onClick={() => ref.current?.click()} onDragEnter={(event) => { event.preventDefault(); setDragOver(true); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragOver(true); }} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragOver(false); }} onDrop={handleDrop}>
      <strong className="drop-icon" aria-hidden="true"><UploadIcon/></strong>
      <span>{dropRejected ? tr('Format file tidak didukung', 'File format not supported') : files.length ? tr(`${files.length} file dipilih`, `${files.length} file(s) selected`) : IS_TOUCH ? tr('Ketuk untuk memilih file', 'Tap to choose files') : tr('Pilih atau jatuhkan file lokal', 'Choose or drop local files')}</span>
      <small>{tr('Tidak ada upload ke server', 'Nothing is uploaded to a server')}</small>
    </button>
    <input ref={ref} hidden type="file" accept={tool.accept} multiple={!singleFile} onChange={(e) => choose(e.target.files)} />

    {files.length > 0 && toolId === 'split' && pageCount > 0 && (
      <SplitPanel bytes={files[0].bytes} filename={files[0].name} pageCount={pageCount} onProcess={handleSplit} busy={busy} />
    )}

    {files.length > 0 && toolId === 'delete-pages' && pageCount > 0 && (
      <PageSelectPanel bytes={files[0].bytes} pageCount={pageCount} onProcess={handleDeletePages} busy={busy} title={tr('Hapus halaman', 'Delete pages')} hint={tr('Halaman yang dipilih akan dihapus dari dokumen.', 'The selected pages will be removed from the document.')} />
    )}

    {files.length > 0 && toolId === 'reorder-pages' && pageCount > 0 && (
      <ReorderPanel bytes={files[0].bytes} pageCount={pageCount} order={reorderOrder} onOrderChange={setReorderOrder} onProcess={handleReorder} busy={busy} />
    )}

    {files.length > 0 && toolId === 'page-numbers' && (
      <AnnotatePanel bytes={files[0].bytes} mode="page-numbers" onProcess={handleAnnotate} busy={busy} />
    )}

    {files.length > 0 && toolId === 'watermark' && (
      <AnnotatePanel bytes={files[0].bytes} mode="watermark" onProcess={handleAnnotate} busy={busy} />
    )}

    {files.length > 0 && toolId === 'crop' && (
      <CropPanel bytes={files[0].bytes} onProcess={handleCrop} busy={busy} />
    )}

    {files.length > 0 && toolId === 'rotate' && pageCount > 0 && (
      <RotatePanel bytes={files[0].bytes} pageCount={pageCount} onProcess={(opts: Record<string, unknown>) => runWorker('rotate', [files[0].bytes], opts)} busy={busy} />
    )}

    {files.length > 0 && toolId === 'metadata' && (
      <ToolOptionsForm fields={METADATA_FIELDS} onProcess={handleFormTool} busy={busy} submitLabel={tr('Simpan metadata →', 'Save metadata →')} />
    )}

    {files.length > 0 && toolId === 'pdf-to-image' && (
      <ToolOptionsForm fields={PDF_TO_IMAGE_FIELDS} onProcess={handlePdfToImage} onSecondary={handlePdfToImageZip} secondaryLabel={tr('Konversi halaman → ZIP', 'Convert pages → ZIP')} busy={busy} submitLabel={pageCount ? tr(`Konversi ${pageCount} halaman →`, `Convert ${pageCount} pages →`) : tr('Konversi semua halaman →', 'Convert all pages →')} />
    )}

    {files.length > 0 && toolId === 'compress' && (
      <ToolOptionsForm fields={COMPRESS_FIELDS} onProcess={handleCompress} busy={busy} submitLabel={tr('Kompres PDF →', 'Compress PDF →')}>
        <p className="split-hint">{tr('Ringan hampir tidak mengecilkan PDF hasil scan atau yang penuh foto. Untuk itu pilih Sedang atau Kuat, tapi teks di hasilnya tidak bisa dipilih atau dicari lagi.', 'Light barely shrinks scanned or photo-heavy PDFs. For those pick Medium or Strong, but the text in the result can no longer be selected or searched.')}</p>
      </ToolOptionsForm>
    )}

    {files.length > 0 && toolId === 'edit-text' && (
      <EditTextPanel bytes={files[0].bytes} onProcess={handleEditText} busy={busy} />
    )}

    {files.length > 0 && toolId === 'redact' && (
      <RedactPanel bytes={files[0].bytes} onProcess={handleRedact} busy={busy} />
    )}

    {files.length > 0 && toolId === 'n-up' && (
      <ToolOptionsForm fields={NUP_FIELDS} onProcess={(values) => runWorker('n-up', [files[0].bytes], { layout: values.layout, filename: files[0].name })} busy={busy} submitLabel={tr('Susun halaman →', 'Arrange pages →')}>
        <p className="split-hint">{tr('Buklet: cetak bolak-balik dengan balik di sisi pendek (short edge), tumpuk, lalu lipat di tengah. Jumlah halaman dilengkapi halaman kosong sampai kelipatan 4.', 'Booklet: print double-sided flipping on the short edge, stack, then fold in the middle. Blank pages are added up to a multiple of 4.')}</p>
      </ToolOptionsForm>
    )}

    {files.length > 0 && toolId === 'ocr' && (
      <ToolOptionsForm fields={[]} onProcess={() => handleOcr(false)} onSecondary={() => handleOcr(true)} secondaryLabel={tr('Unduh teksnya saja (.txt)', 'Download the text only (.txt)')} busy={busy} submitLabel={tr('Buat PDF bisa dicari →', 'Make PDF searchable →')}>
        <p className="split-hint">{tr('Mengenali teks berbahasa Indonesia dan Inggris. Pemakaian pertama mengunduh mesin OCR ±8 MB, dan tiap halaman butuh beberapa detik. Halaman yang sudah berisi teks dilewati.', 'Recognizes Indonesian and English text. First use downloads a ±8 MB OCR engine, and each page takes a few seconds. Pages that already have text are skipped.')}</p>
      </ToolOptionsForm>
    )}

    {files.length > 0 && toolId === 'extract-text' && (
      <button className="primary" onClick={handleExtractText} disabled={busy}>{busy ? tr('Memproses…', 'Processing…') : tr('Ekstrak teks →', 'Extract text →')}</button>
    )}

    {files.length > 0 && toolId === 'sign' && (
      <SignPanel bytes={files[0].bytes} onProcess={handleSign} busy={busy} />
    )}

    {files.length > 0 && toolId === 'image-toolkit' && (
      <ImageToolkitPanel files={files} onProcess={handleImageToolkit} />
    )}

    {files.length > 0 && toolId === 'image-watermark' && (
      <AnnotatePanel bytes={files[0].bytes} mode="watermark" images={files} onImages={handleImageToolkit} busy={busy} />
    )}

    {files.length > 0 && toolId === 'remove-bg' && (
      <RemoveBgPanel bytes={files[0].bytes} onProcess={handleRemoveBg} busy={busy} />
    )}
    {files.length > 0 && toolId === 'fill-form' && (
      <FormFillPanel bytes={files[0].bytes} onProcess={handleFormDownload} busy={busy} />
    )}

    {files.length > 0 && toolId === 'flatten' && (
      <button className="primary" onClick={handleFlatten} disabled={busy}>
        {busy ? tr('Memproses…', 'Processing…') : tr('Ratakan formulir →', 'Flatten form →')}
      </button>
    )}

    {files.length > 0 && toolId === 'merge' && (
      <>
        <div className="merge-file-list">
          {files.map((file, i) => (
            <div key={file.id} className="merge-file-row">
              <span className="merge-file-dot" style={{ background: FILE_COLORS[i % FILE_COLORS.length] }} />
              <span className="merge-file-name">{file.name}</span>
              <button type="button" className="merge-file-remove" aria-label={tr(`Hapus ${file.name}`, `Remove ${file.name}`)} onClick={() => removeFile(i)} disabled={files.length <= 1}>✕</button>
            </div>
          ))}
        </div>
        <button className="ghost-btn add-more-btn" onClick={() => addMoreRef.current?.click()}>
          ＋ {tr('Tambah file PDF', 'Add PDF files')}
        </button>
        <input ref={addMoreRef} hidden type="file" accept={tool.accept} multiple onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        <MergePanel files={mergeFiles} onProcess={handleMergePages} busy={busy} />
      </>
    )}

    {files.length > 0 && toolId === 'unlock' && (
      <div className="split-panel">
        <div className="tool-form">
          <div className="tool-form-field">
            <label className="tool-form-label" htmlFor="unlock-password">{tr('Password PDF (opsional)', 'PDF password (optional)')}</label>
            <input id="unlock-password" type="password" className="tool-form-input" value={unlockPassword} placeholder={tr('Kosongkan jika PDF bisa dibuka tanpa password', 'Leave empty if the PDF opens without a password')} onChange={(e) => setUnlockPassword(e.target.value)} />
          </div>
        </div>
        <button className="primary" onClick={handleUnlock} disabled={busy}>
          {busy ? tr('Memproses…', 'Processing…') : tr('Hapus proteksi →', 'Unlock →')}
        </button>
      </div>
    )}

    {files.length > 0 && toolId === 'protect' && (
      <div className="split-panel">
        <div className="tool-form">
          <div className="tool-form-field">
            <label className="tool-form-label" htmlFor="protect-password">{tr('Password buka (wajib)', 'Open password (required)')}</label>
            <input id="protect-password" type="password" className="tool-form-input" value={protectPassword} placeholder={tr('Password yang diminta saat membuka PDF', 'Password asked when opening the PDF')} onChange={(e) => setProtectPassword(e.target.value)} />
          </div>
          <div className="tool-form-field">
            <label className="tool-form-label" htmlFor="protect-owner">{tr('Password pemilik (opsional)', 'Owner password (optional)')}</label>
            <input id="protect-owner" type="password" className="tool-form-input" value={protectOwner} placeholder={tr('Akses penuh tanpa batasan; default sama dengan password buka', 'Full unrestricted access; defaults to the open password')} onChange={(e) => setProtectOwner(e.target.value)} />
          </div>
        </div>
        <button className="primary" onClick={handleProtect} disabled={busy}>
          {busy ? tr('Memproses…', 'Processing…') : tr('Beri password →', 'Protect →')}
        </button>
      </div>
    )}

    {files.length > 0 && SIMPLE_BUTTON_TOOLS.has(toolId!) && (
      <button className="primary" onClick={() => {
        const opts = toolId === 'image-to-pdf' ? { type: /\.jpe?g$/i.test(files[0]?.name ?? '') ? 'jpg' : 'png' } : toolId === 'office-to-pdf' || toolId === 'sanitize' ? { filename: files[0]?.name } : undefined;
        runWorker(toolId!, files.map((f) => f.bytes), opts);
      }} disabled={busy}>{busy ? tr('Memproses…', 'Processing…') : tr('Jalankan proses →', 'Run →')}</button>
    )}

    <div className="status" role="status" aria-live="polite">
      <span className={phase ? 'pulse' : ''} />{status}{stalled ? STALL_HINT : ''}
    </div>
  </div>;
}

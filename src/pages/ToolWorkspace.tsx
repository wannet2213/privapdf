import { useParams, Link } from 'react-router-dom';
import { tools } from '../tools/registry';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { readSessionFiles, clearSession, type SessionFile } from '../lib/file-session';
import { PDFDocument } from 'pdf-lib';
import { runJob } from '../engine/engine-client';
import type { Phase, SplitOptions } from '../engine/types';
import { filterSupportedFiles } from '../lib/validation';
import { createZip } from '../lib/zip';
import { SplitPanel } from '../components/SplitPanel';
import { PageSelectPanel } from '../components/PageSelectPanel';
import { ReorderPanel } from '../components/ReorderPanel';
import { AnnotatePanel } from '../components/AnnotatePanel';
import { CropPanel } from '../components/CropPanel';
import { RotatePanel } from '../components/RotatePanel';
import { MergePanel, type PageRef } from '../components/MergePanel';
import { ToolOptionsForm, type Field } from '../components/ToolOptionsForm';
import { pdfToImages, extractText } from '../lib/pdf-client';

const METADATA_FIELDS: Field[] = [
  { name: 'title', label: 'Judul', type: 'text', placeholder: 'Judul dokumen' },
  { name: 'author', label: 'Penulis', type: 'text', placeholder: 'Nama penulis' },
  { name: 'subject', label: 'Subjek', type: 'text', placeholder: 'Topik dokumen' },
  { name: 'keywords', label: 'Kata kunci', type: 'text', placeholder: 'pisahkan dengan koma' },
  { name: 'creator', label: 'Pembuat', type: 'text', placeholder: 'Aplikasi pembuat' },
];

const FILE_COLORS = ['#E5322D', '#2FA36B', '#3B6FE0', '#8B5CF6', '#E88C30', '#0E9F9F'];

const UploadIcon = () => (
  <svg viewBox="0 0 24 24" width="46" height="46" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 15.5V5" /><path d="m7.5 9.5 4.5-4.5 4.5 4.5" /><path d="M4 16.5V19a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-2.5" />
  </svg>
);

const PDF_TO_IMAGE_FIELDS: Field[] = [
  { name: 'format', label: 'Format', type: 'select', default: 'png', options: [{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPEG' }] },
  { name: 'scale', label: 'Resolusi', type: 'select', default: '2', options: [{ value: '1', label: 'Standar (1x)' }, { value: '2', label: 'Tinggi (2x)' }, { value: '3', label: 'Maksimum (3x)' }] },
];

const SIMPLE_BUTTON_TOOLS = new Set(['image-to-pdf', 'office-to-pdf', 'compress']);

const IS_TOUCH = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

export function ToolWorkspace() {
  const { toolId } = useParams();
  const tool = tools.find((item) => item.id === toolId);
  const ref = useRef<HTMLInputElement>(null);
  const addMoreRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<SessionFile[]>([]);
  const filesRef = useRef<SessionFile[]>([]);
  const [status, setStatus] = useState('Pilih file dari perangkatmu.');
  const [phase, setPhase] = useState<Phase>();
  const [pageCount, setPageCount] = useState(0);
  const [reorderOrder, setReorderOrder] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dropRejected, setDropRejected] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState('');
  useEffect(() => { filesRef.current = files; }, [files]);
  useEffect(() => { const cleanup = () => clearSession(filesRef.current); window.addEventListener('pagehide', cleanup); window.addEventListener('beforeunload', cleanup); return () => { window.removeEventListener('pagehide', cleanup); window.removeEventListener('beforeunload', cleanup); cleanup(); }; }, []);

  if (!tool) return <div className="page"><h1>Tool tidak ditemukan.</h1></div>;

  const needsPageCount = toolId === 'split' || toolId === 'delete-pages' || toolId === 'reorder-pages' || toolId === 'rotate';

  const choose = async (list: FileList | null) => {
    if (!list) return;
    setDropRejected(false);
    const accepted = filterSupportedFiles([...list], tool.accept);
    if (!accepted.length) { setDropRejected(true); setStatus('Format file tidak didukung.'); return; }
    setPhase(undefined);
    setStatus('Membaca file…');
    try {
      const next = await readSessionFiles([...list]);
      setFiles(next);
      setPageCount(0);
      setStatus('File siap. Jalankan proses atau atur opsi.');
      if (needsPageCount && next[0]) {
        const doc = await PDFDocument.load(next[0].bytes);
        const count = doc.getPageCount();
        setPageCount(count);
        if (toolId === 'reorder-pages') setReorderOrder(Array.from({ length: count }, (_, i) => i));
      }
    } catch (e) { setStatus(e instanceof Error ? e.message : 'File tidak valid.'); }
  };

  const addFiles = async (list: FileList | null) => {
    if (!list || !list.length) return;
    const accepted = filterSupportedFiles([...list], tool.accept);
    if (!accepted.length) { setStatus('Format file tidak didukung.'); return; }
    setStatus('Menambahkan file…');
    try {
      const more = await readSessionFiles([...list]);
      setFiles((prev) => [...prev, ...more]);
      setStatus(`${more.length} file ditambahkan. Total ${files.length + more.length} file.`);
    } catch (e) { setStatus(e instanceof Error ? e.message : 'File tidak valid.'); }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => {
      const next = prev.filter((_, i) => i !== index);
      setStatus(next.length ? `${next.length} file tersisa.` : 'Pilih file dari perangkatmu.');
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
    setBusy(true); setPhase(undefined); setStatus('Memproses…');
    try {
      let outputNames: string[] | undefined;
      const outputs = await runJob({ jobId: crypto.randomUUID(), operation: operation as never, inputs, options } as never, (event: { type: string; phase?: Phase; progress?: number; outputNames?: string[] }) => {
        setPhase(event.phase); outputNames = event.outputNames;
        if (event.type === 'progress') setStatus(`${event.phase} · ${Math.round((event.progress || 0) * 100)}%`);
      });
      const names = outputNames?.length ? outputNames : outputs.map((_, i) => `${files[0]?.name?.replace(/\.[^.]+$/, '') || 'document'}-${i + 1}.${defaultExt}`);
      if (zipOutput && outputs.length > 1) {
        setStatus('Mengemas ZIP…');
        const zipName = `${files[0]?.name?.replace(/\.[^.]+$/, '') || 'document'}.zip`;
        downloadBlobs([await createZip(outputs.map((b, i) => ({ name: names[i], bytes: b })))], [zipName], 'application/zip');
        setStatus(`Selesai. ${outputs.length} file dikemas dalam ${zipName}.`);
      } else {
        downloadBlobs(outputs.map((b) => new Blob([b])), names, mime);
        setStatus(`Selesai. ${outputs.length} file telah diunduh.`);
      }
    } catch (e) { setStatus(e instanceof Error ? e.message : 'Pemrosesan gagal.'); }
    setBusy(false);
  };

  const handleSplit = (options: SplitOptions) => runWorker('split', [files[0].bytes], { ...options }, 'application/pdf', 'pdf', options.asZip === true);
  const handleDeletePages = (indices: number[]) => runWorker('delete-pages', [files[0].bytes], { indices });
  const handleReorder = () => runWorker('reorder-pages', [files[0].bytes], { order: reorderOrder });
  const handleAnnotate = (opts: Record<string, unknown>) => runWorker(toolId!, [files[0].bytes], opts);
  const handleCrop = (opts: Record<string, unknown>) => runWorker('crop', [files[0].bytes], opts);
  const handleMergePages = (refs: PageRef[]) => runWorker('merge-pages', files.map((f) => f.bytes), { refs });

  // Identitas stabil untuk prop MergePanel — tanpa ini parent re-render akan me-reload dokumen dan mereset urutan user
  const mergeFiles = useMemo(() => files.map((f) => ({ bytes: f.bytes, name: f.name })), [files]);

  const handleFormTool = (values: Record<string, string | number>) => {
    const opts: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (typeof v === 'string' && v.trim()) opts[k] = v;
      else if (typeof v === 'number') opts[k] = v;
    }
    runWorker(toolId!, [files[0].bytes], opts);
  };

  const handlePdfToImage = async (values: Record<string, string | number>) => {
    const format = values.format as 'png' | 'jpeg';
    const scale = Number(values.scale) || 2;
    setBusy(true); setStatus('Merender halaman…');
    try {
      const blobs = await pdfToImages(files[0].bytes, { format, scale }, (cur, total) => setStatus(`Merender halaman ${cur}/${total}…`));
      const names = blobs.map((_, i) => `${files[0].name.replace(/\.pdf$/i, '')}-hal-${i + 1}.${format === 'jpeg' ? 'jpg' : 'png'}`);
      downloadBlobs(blobs, names, `image/${format}`);
      setStatus(`Selesai. ${blobs.length} gambar telah diunduh.`);
    } catch (e) { setStatus(e instanceof Error ? e.message : 'Render gagal.'); }
    setBusy(false);
  };

  const handleExtractText = async () => {
    setBusy(true); setStatus('Mengekstrak teks…');
    try {
      const result = await extractText(files[0].bytes, (cur, total) => setStatus(`Mengekstrak halaman ${cur}/${total}…`));
      const blob = new Blob([result.text], { type: 'text/plain;charset=utf-8' });
      const names = [`${files[0].name.replace(/\.pdf$/i, '')}.txt`];
      downloadBlobs([blob], names, 'text/plain');
      setStatus(`Selesai. ${result.pages} halaman diproses, ${result.text.length} karakter diekstrak.`);
    } catch (e) { setStatus(e instanceof Error ? e.message : 'Ekstraksi gagal.'); }
    setBusy(false);
  };

  const handleUnlock = () => runWorker('unlock', [files[0].bytes], unlockPassword.trim() ? { password: unlockPassword } : undefined);

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => { event.preventDefault(); setDragOver(false); choose(event.dataTransfer.files); };
  const singleFile = toolId !== 'merge';

  return <div className="workspace page">
    <Link className="back" to="/tools">← semua tools</Link>
    <div className="eyebrow">WORKSPACE / {toolId?.toUpperCase()}</div>
    <h1>{tool.label}</h1>
    <p className="lead">{tool.description}</p>
    <button className={`drop compact ${dragOver ? 'is-drag-over' : ''} ${dropRejected ? 'drop-rejected' : ''}`} onClick={() => ref.current?.click()} onDragEnter={(event) => { event.preventDefault(); setDragOver(true); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragOver(true); }} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragOver(false); }} onDrop={handleDrop}>
      <strong className="drop-icon" aria-hidden="true"><UploadIcon/></strong>
      <span>{dropRejected ? 'Format file tidak didukung' : files.length ? `${files.length} file dipilih` : IS_TOUCH ? 'Ketuk untuk memilih file' : 'Pilih atau jatuhkan file lokal'}</span>
      <small>Tidak ada upload ke server</small>
    </button>
    <input ref={ref} hidden type="file" accept={tool.accept} multiple={!singleFile} onChange={(e) => choose(e.target.files)} />

    {files.length > 0 && toolId === 'split' && pageCount > 0 && (
      <SplitPanel bytes={files[0].bytes} filename={files[0].name} pageCount={pageCount} onProcess={handleSplit} busy={busy} />
    )}

    {files.length > 0 && toolId === 'delete-pages' && pageCount > 0 && (
      <PageSelectPanel bytes={files[0].bytes} pageCount={pageCount} onProcess={handleDeletePages} busy={busy} title="Hapus halaman" hint="Halaman yang dipilih akan dihapus dari dokumen." />
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
      <ToolOptionsForm fields={METADATA_FIELDS} onProcess={handleFormTool} busy={busy} submitLabel="Simpan metadata →" />
    )}

    {files.length > 0 && toolId === 'pdf-to-image' && (
      <ToolOptionsForm fields={PDF_TO_IMAGE_FIELDS} onProcess={handlePdfToImage} busy={busy} submitLabel={`Konversi ${pageCount || 'semua'} halaman →`} />
    )}

    {files.length > 0 && toolId === 'extract-text' && (
      <button className="primary" onClick={handleExtractText} disabled={busy}>{busy ? 'Memproses…' : 'Ekstrak teks →'}</button>
    )}

    {files.length > 0 && toolId === 'merge' && (
      <>
        <div className="merge-file-list">
          {files.map((file, i) => (
            <div key={file.id} className="merge-file-row">
              <span className="merge-file-dot" style={{ background: FILE_COLORS[i % FILE_COLORS.length] }} />
              <span className="merge-file-name">{file.name}</span>
              <button type="button" className="merge-file-remove" aria-label={`Hapus ${file.name}`} onClick={() => removeFile(i)} disabled={files.length <= 1}>✕</button>
            </div>
          ))}
        </div>
        <button className="ghost-btn add-more-btn" onClick={() => addMoreRef.current?.click()}>
          ＋ Tambah file PDF
        </button>
        <input ref={addMoreRef} hidden type="file" accept={tool.accept} multiple onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        <MergePanel files={mergeFiles} onProcess={handleMergePages} busy={busy} />
      </>
    )}

    {files.length > 0 && toolId === 'unlock' && (
      <div className="split-panel">
        <div className="tool-form">
          <div className="tool-form-field">
            <label className="tool-form-label" htmlFor="unlock-password">Password PDF (opsional)</label>
            <input id="unlock-password" type="password" className="tool-form-input" value={unlockPassword} placeholder="Kosongkan jika PDF bisa dibuka tanpa password" onChange={(e) => setUnlockPassword(e.target.value)} />
          </div>
        </div>
        <button className="primary" onClick={handleUnlock} disabled={busy}>
          {busy ? 'Memproses…' : 'Hapus proteksi →'}
        </button>
      </div>
    )}

    {files.length > 0 && SIMPLE_BUTTON_TOOLS.has(toolId!) && (
      <button className="primary" onClick={() => {
        const opts = toolId === 'image-to-pdf' ? { type: files[0]?.type.includes('jpeg') ? 'jpg' : 'png' } : toolId === 'office-to-pdf' ? { filename: files[0]?.name } : undefined;
        runWorker(toolId!, files.map((f) => f.bytes), opts);
      }} disabled={busy}>{busy ? 'Memproses…' : 'Jalankan proses →'}</button>
    )}

    <div className="status" role="status" aria-live="polite">
      <span className={phase ? 'pulse' : ''} />{status}
    </div>
  </div>;
}

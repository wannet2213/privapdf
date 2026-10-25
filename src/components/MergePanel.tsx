import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PageViewer } from './PageViewer';
import { moveFileGroup } from '../lib/reorder';
import { useDragSort } from '../lib/use-drag-sort';
import { tr } from '../lib/i18n';

GlobalWorkerOptions.workerSrc = workerUrl;

export interface MergeFile { bytes: ArrayBuffer; name: string; }
export interface PageRef { file: number; page: number; }

interface MergePanelProps {
  files: MergeFile[];
  onProcess: (refs: PageRef[]) => void;
  busy: boolean;
}

const PREVIEW_SCALE = 0.28;

const FILE_COLORS = ['#E5322D', '#2FA36B', '#3B6FE0', '#8B5CF6', '#E88C30', '#0E9F9F'];

function refKey(r: PageRef) { return `${r.file}-${r.page}`; }

export function MergePanel({ files, onProcess, busy }: MergePanelProps) {
  const docs = useRef<Map<number, PDFDocumentProxy>>(new Map());
  const canvases = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const cards = useRef<Map<string, HTMLElement>>(new Map());
  const tasks = useRef<Map<string, RenderTask>>(new Map());
  const [pageCounts, setPageCounts] = useState<number[]>([]);
  const [refs, setRefs] = useState<PageRef[]>([]);
  const [rendered, setRendered] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [viewing, setViewing] = useState<PageRef | null>(null);
  const [mode, setMode] = useState<'halaman' | 'file'>('halaman');

  // Load all documents, build initial refs
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    setRendered(new Set());
    const load = async () => {
      try {
        const counts: number[] = [];
        const initialRefs: PageRef[] = [];
        for (let fi = 0; fi < files.length; fi++) {
          const doc = await getDocument({ data: new Uint8Array(files[fi].bytes.slice(0)) }).promise;
          if (cancelled) { void doc.destroy(); return; }
          docs.current.set(fi, doc);
          counts.push(doc.numPages);
          for (let pi = 0; pi < doc.numPages; pi++) initialRefs.push({ file: fi, page: pi });
        }
        if (cancelled) return;
        setPageCounts(counts);
        setRefs(initialRefs);
        setLoading(false);
      } catch {
        if (!cancelled) { setError(tr('Gagal memuat salah satu dokumen.', 'Failed to load one of the documents.')); setLoading(false); }
      }
    };
    void load();
    return () => {
      cancelled = true;
      tasks.current.forEach((t) => t.cancel());
      tasks.current.clear();
      docs.current.forEach((d) => void d.destroy());
      docs.current.clear();
      canvases.current.forEach((c) => { c.width = 0; c.height = 0; });
      canvases.current.clear();
      cards.current.clear();
    };
  }, [files]);

  // Render thumbnails lazily
  useEffect(() => {
    if (loading || !refs.length) return;
    let cancelled = false;
    const render = async (ref: PageRef) => {
      const key = refKey(ref);
      const doc = docs.current.get(ref.file);
      const canvas = canvases.current.get(key);
      if (!doc || !canvas || rendered.has(key) || tasks.current.has(key)) return;
      try {
        const page: PDFPageProxy = await doc.getPage(ref.page + 1);
        if (cancelled) { page.cleanup(); return; }
        const viewport = page.getViewport({ scale: PREVIEW_SCALE });
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const task = page.render({ canvasContext: ctx, viewport });
        tasks.current.set(key, task);
        await task.promise;
        tasks.current.delete(key);
        page.cleanup();
        if (!cancelled) setRendered((cur) => new Set(cur).add(key));
      } catch (reason) {
        tasks.current.delete(key);
        if (!cancelled && !(reason instanceof Error && reason.name === 'RenderingCancelledException')) {
          setError(tr('Gagal merender beberapa halaman.', 'Failed to render some pages.'));
        }
      }
    };
    const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const key = (entry.target as HTMLElement).dataset.refKey;
          const ref = refs.find((r) => refKey(r) === key);
          if (ref) void render(ref);
        }
      });
    }, { rootMargin: '300px' });
    cards.current.forEach((c) => observer?.observe(c));
    return () => { cancelled = true; observer?.disconnect(); };
  }, [loading, refs, rendered]);

  // Drag kartu & baris: mouse = langsung, sentuh = tahan dulu (lihat useDragSort).
  const validRefs = refs.filter((r) => r.file >= 0 && r.file < files.length);
  // Urutan grup file menurut kondisi refs saat ini; halaman yang diacak manual tetap satu grup.
  const groupOrder: number[] = [];
  for (const r of validRefs) if (!groupOrder.includes(r.file)) groupOrder.push(r.file);
  const moveGroupTo = (gi: number, ti: number) => {
    if (gi === ti || ti < 0 || ti >= groupOrder.length) return;
    setRefs((prev) => moveFileGroup(prev, groupOrder[gi], groupOrder[ti], ti < gi));
  };
  const cardDrag = useDragSort('[data-merge-index]', 'mergeIndex', (from, to) => {
    setRefs((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  });
  const rowDrag = useDragSort('[data-group-index]', 'groupIndex', moveGroupTo);
  const dragging = cardDrag.dragging;
  const over = cardDrag.over;

  const deleteRef = (ref: PageRef) => {
    setRefs((prev) => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex((r) => r.file === ref.file && r.page === ref.page);
      if (idx < 0) return prev;
      const next = [...prev];
      next.splice(idx, 1);
      return next;
    });
  };

  if (loading) return <div className="annotate-loading">{tr(`Memuat ${files.length} dokumen…`, `Loading ${files.length} document(s)…`)}</div>;
  if (error) return <div className="preview-error" role="alert">{error}</div>;

  return (
    <div className="split-panel">
      <div className="preview-heading">
        <span>{tr(`${validRefs.length} halaman dari ${files.length} dokumen`, `${validRefs.length} pages from ${files.length} document(s)`)}</span>
        <small>{mode === 'halaman' ? tr('Tahan lalu seret kartu untuk mengatur urutan', 'Press and drag cards to set the order') : tr('Gunakan ↑↓ untuk memindahkan file', 'Use ↑↓ to move files')}</small>
      </div>
      <div className="split-tabs" role="tablist" aria-label={tr('Mode pengurutan gabungan', 'Merge ordering mode')}>
        <button role="tab" aria-selected={mode === 'halaman'} className={`split-tab ${mode === 'halaman' ? 'is-active' : ''}`} onClick={() => setMode('halaman')}>{tr('Per halaman', 'By page')}</button>
        <button role="tab" aria-selected={mode === 'file'} className={`split-tab ${mode === 'file' ? 'is-active' : ''}`} onClick={() => setMode('file')}>{tr('Per file', 'By file')}</button>
      </div>
      <div className="merge-legend">
        {files.map((f, i) => pageCounts[i] ? (
          <span key={i} className="merge-legend-item">
            <span className="merge-legend-dot" style={{ background: FILE_COLORS[i % FILE_COLORS.length] }} />
            {f.name} ({pageCounts[i]})
          </span>
        ) : null)}
      </div>
      {/* Grid tetap ter-mount di kedua mode: meng-unmount memusnahkan canvas
          pratinjau sehingga kembali ke mode ini menampilkan kartu kosong. */}
      <div className="preview-grid merge-grid" aria-busy={!validRefs.length} style={{ display: mode === 'halaman' ? undefined : 'none' }}>
        {validRefs.map((ref, index) => {
          const key = refKey(ref);
          return (
            <article
              key={key}
              ref={(card) => { if (card) cards.current.set(key, card); else cards.current.delete(key); }}
              data-merge-index={index}
              data-ref-key={key}
              className={`page-card merge-card ${over === index ? 'drop-target' : ''} ${dragging === index ? 'is-dragging' : ''}`}
              onPointerDown={(e) => { if ((e.target as HTMLElement).closest('button, .merge-delete-btn')) return; cardDrag.onPointerDown(e, index); }}
              onPointerMove={cardDrag.onPointerMove}
              onPointerEnter={() => cardDrag.onPointerEnter(index)}
              onPointerUp={() => cardDrag.onPointerUp(index)}
              onPointerCancel={cardDrag.cancel}
              onLostPointerCapture={cardDrag.cancel}
              onContextMenu={(e) => e.preventDefault()}
            >
              <div className="page-thumb" onClick={() => { if (Date.now() - cardDrag.didDragAt() < 300) return; setViewing(ref); }}>
                <canvas ref={(c) => { if (c) canvases.current.set(key, c); else canvases.current.delete(key); }} />
                {!rendered.has(key) && <span className="preview-loading" aria-hidden="true">…</span>}
                <span className="page-thumb-zoom" aria-hidden="true">⤢</span>
                <span className="merge-file-badge" style={{ background: FILE_COLORS[ref.file % FILE_COLORS.length] }}>
                  {files[ref.file].name.replace(/\.pdf$/i, '').slice(0, 8)}
                </span>
              </div>
              <div className="merge-card-foot">
                <span className="merge-pos">{index + 1}</span>
                <button type="button" className="merge-delete-btn" aria-label={tr(`Hapus halaman ${index + 1}`, `Remove page ${index + 1}`)} onClick={() => deleteRef(ref)} disabled={validRefs.length <= 1}>✕</button>
              </div>
            </article>
          );
        })}
      </div>
      {mode === 'file' && (
      <div className="file-order">
        {groupOrder.map((fi, gi) => (
          <div
            key={fi}
            data-group-index={gi}
            className={`file-order-row ${rowDrag.dragging === gi ? 'is-dragging' : ''} ${rowDrag.over === gi && rowDrag.dragging !== null && rowDrag.dragging !== gi ? 'drop-target' : ''}`}
            onPointerDown={(e) => { if ((e.target as HTMLElement).closest('button')) return; rowDrag.onPointerDown(e, gi); }}
            onPointerMove={rowDrag.onPointerMove}
            onPointerUp={() => rowDrag.onPointerUp(gi)}
            onPointerCancel={rowDrag.cancel}
            onLostPointerCapture={rowDrag.cancel}
            onContextMenu={(e) => e.preventDefault()}
          >
            <span className="merge-legend-dot" style={{ background: FILE_COLORS[fi % FILE_COLORS.length] }} />
            <span className="merge-file-name">{files[fi].name}</span>
            <small>{tr(`${pageCounts[fi]} halaman`, `${pageCounts[fi]} pages`)}</small>
            <span className="reorder-buttons">
              <button type="button" aria-label={tr(`Naikkan ${files[fi].name}`, `Move ${files[fi].name} up`)} disabled={gi === 0} onClick={() => moveGroupTo(gi, gi - 1)}>↑</button>
              <button type="button" aria-label={tr(`Turunkan ${files[fi].name}`, `Move ${files[fi].name} down`)} disabled={gi === groupOrder.length - 1} onClick={() => moveGroupTo(gi, gi + 1)}>↓</button>
            </span>
          </div>
        ))}
      </div>
      )}
      <p className="split-hint">{tr('Urutan akhir', 'Final order')}: {validRefs.map((r) => pageCounts.slice(0, r.file).reduce((a, b) => a + b, 0) + r.page + 1).join(' → ')}</p>
      <button className="primary" onClick={() => onProcess(validRefs)} disabled={busy || validRefs.length < 1}>
        {busy ? tr('Memproses…', 'Processing…') : tr(`Gabungkan ${validRefs.length} halaman`, `Merge ${validRefs.length} pages`)}
      </button>
      {viewing && pageCounts[viewing.file] && (
        <PageViewer
          bytes={files[viewing.file].bytes}
          pageNumber={viewing.page}
          totalPages={pageCounts[viewing.file]}
          onClose={() => setViewing(null)}
          onPageChange={(page) => setViewing({ ...viewing, page })}
        />
      )}
    </div>
  );
}

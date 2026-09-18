import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PageViewer } from './PageViewer';
import { moveFileGroup } from '../lib/reorder';

GlobalWorkerOptions.workerSrc = workerUrl;

export interface MergeFile { bytes: ArrayBuffer; name: string; }
export interface PageRef { file: number; page: number; }

interface MergePanelProps {
  files: MergeFile[];
  onProcess: (refs: PageRef[]) => void;
  busy: boolean;
}

const PREVIEW_SCALE = 0.28;
const DRAG_THRESHOLD = 5;

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
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [viewing, setViewing] = useState<PageRef | null>(null);

  const downRef = useRef<{ index: number; x: number; y: number; pointerId: number } | null>(null);
  const draggingRef = useRef<number | null>(null);
  const overIndexRef = useRef<number | null>(null);
  const capturedRef = useRef(false);
  const didDragAtRef = useRef(0);

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
        if (!cancelled) { setError('Gagal memuat salah satu dokumen.'); setLoading(false); }
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
          setError('Gagal merender beberapa halaman.');
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

  const cleanup = () => {
    downRef.current = null;
    draggingRef.current = null;
    overIndexRef.current = null;
    capturedRef.current = false;
    setDragging(null);
    setOver(null);
  };

  const onPointerDown = (e: PointerEvent<HTMLElement>, index: number) => {
    if ((e.target as HTMLElement).closest('button, .merge-delete-btn')) return;
    downRef.current = { index, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    // Tangkap pointer sejak awal agar drag tetap berjalan di layar sentuh.
    // Di iOS Safari, menangkap pointer setelah gerakan dimulai bisa memicu pointercancel.
    if (!capturedRef.current) {
      try { e.currentTarget.setPointerCapture(e.pointerId); capturedRef.current = true; } catch { /* ignore */ }
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const down = downRef.current;
    if (!down) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    if (draggingRef.current === null) {
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        draggingRef.current = down.index;
        overIndexRef.current = down.index;
        didDragAtRef.current = Date.now();
        setDragging(down.index);
        setOver(down.index);
      }
      return;
    }
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-merge-index]');
    const ti = target ? Number(target.dataset.mergeIndex) : null;
    const next = ti !== null && Number.isInteger(ti) ? ti : null;
    overIndexRef.current = next;
    setOver(next);
  };

  const onPointerUp = (index: number) => {
    if (draggingRef.current !== null) {
      const target = overIndexRef.current ?? index;
      const from = draggingRef.current;
      if (from !== target) {
        setRefs((prev) => {
          const next = [...prev];
          const [moved] = next.splice(from, 1);
          next.splice(target, 0, moved);
          return next;
        });
      }
    }
    cleanup();
  };

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

  if (loading) return <div className="annotate-loading">Memuat {files.length} dokumen…</div>;
  if (error) return <div className="preview-error" role="alert">{error}</div>;

  // Guard: buang ref yang menunjuk file terhapus (render transisi sebelum effect reload jalan)
  const validRefs = refs.filter((r) => r.file >= 0 && r.file < files.length);

  // Tetangga terdekat yang masih punya halaman; null = tidak ada grup untuk ditukar.
  const neighborWithPages = (fi: number, dir: -1 | 1) => {
    for (let i = fi + dir; i >= 0 && i < files.length; i += dir) {
      if (validRefs.some((r) => r.file === i)) return i;
    }
    return null;
  };
  const moveFile = (fi: number, dir: -1 | 1) => {
    const target = neighborWithPages(fi, dir);
    if (target === null) return;
    setRefs((prev) => moveFileGroup(prev, fi, target, dir === -1));
  };

  return (
    <div className="split-panel">
      <div className="preview-heading">
        <span>{validRefs.length} halaman dari {files.length} dokumen</span>
        <small>Seret halaman, atau ↑↓ di nama file untuk pindahkan per file</small>
      </div>
      <div className="merge-legend">
        {files.map((f, i) => pageCounts[i] ? (
          <span key={i} className="merge-legend-item">
            <span className="merge-legend-dot" style={{ background: FILE_COLORS[i % FILE_COLORS.length] }} />
            {f.name} ({pageCounts[i]})
            <span className="reorder-buttons">
              <button type="button" aria-label={`Naikkan ${f.name}`} disabled={busy || neighborWithPages(i, -1) === null} onClick={() => moveFile(i, -1)}>↑</button>
              <button type="button" aria-label={`Turunkan ${f.name}`} disabled={busy || neighborWithPages(i, 1) === null} onClick={() => moveFile(i, 1)}>↓</button>
            </span>
          </span>
        ) : null)}
      </div>
      <div className="preview-grid merge-grid" aria-busy={!validRefs.length}>
        {validRefs.map((ref, index) => {
          const key = refKey(ref);
          return (
            <article
              key={key}
              ref={(card) => { if (card) cards.current.set(key, card); else cards.current.delete(key); }}
              data-merge-index={index}
              data-ref-key={key}
              className={`page-card merge-card ${over === index ? 'drop-target' : ''} ${dragging === index ? 'is-dragging' : ''}`}
              onPointerDown={(e) => onPointerDown(e, index)}
              onPointerMove={onPointerMove}
              onPointerEnter={() => { if (draggingRef.current !== null) { overIndexRef.current = index; setOver(index); } }}
              onPointerUp={() => onPointerUp(index)}
              onPointerCancel={cleanup}
              onLostPointerCapture={cleanup}
            >
              <div className="page-thumb" onClick={() => { if (Date.now() - didDragAtRef.current < 300) return; setViewing(ref); }}>
                <canvas ref={(c) => { if (c) canvases.current.set(key, c); else canvases.current.delete(key); }} />
                {!rendered.has(key) && <span className="preview-loading" aria-hidden="true">…</span>}
                <span className="page-thumb-zoom" aria-hidden="true">⤢</span>
                <span className="merge-file-badge" style={{ background: FILE_COLORS[ref.file % FILE_COLORS.length] }}>
                  {files[ref.file].name.replace(/\.pdf$/i, '').slice(0, 8)}
                </span>
              </div>
              <div className="merge-card-foot">
                <span className="merge-pos">{index + 1}</span>
                <button type="button" className="merge-delete-btn" aria-label={`Hapus halaman ${index + 1}`} onClick={() => deleteRef(ref)} disabled={validRefs.length <= 1}>✕</button>
              </div>
            </article>
          );
        })}
      </div>
      <p className="split-hint">Urutan akhir: {validRefs.map((r) => pageCounts.slice(0, r.file).reduce((a, b) => a + b, 0) + r.page + 1).join(' → ')}</p>
      <button className="primary" onClick={() => onProcess(validRefs)} disabled={busy || validRefs.length < 1}>
        {busy ? 'Memproses…' : `Gabungkan ${validRefs.length} halaman`}
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

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Box } from '../lib/crop-box';
import { tr } from '../lib/i18n';

GlobalWorkerOptions.workerSrc = workerUrl;

/** Kotak sensor per halaman (indeks 0-based), dalam poin halaman dengan titik asal kiri-atas. */
export type Redactions = Record<number, Box[]>;

interface RedactPanelProps {
  bytes: ArrayBuffer;
  onProcess: (boxes: Redactions) => void;
  busy: boolean;
}

const MIN_SIZE = 3;

export function RedactPanel({ bytes, onProcess, busy }: RedactPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PDFDocumentProxy | undefined>(undefined);
  const taskRef = useRef<RenderTask | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [boxes, setBoxes] = useState<Redactions>({});
  const [draft, setDraft] = useState<{ sx: number; sy: number; box: Box } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise.then((doc) => {
      if (cancelled) { void doc.destroy(); return; }
      docRef.current = doc;
      setPageCount(doc.numPages);
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      taskRef.current?.cancel();
      docRef.current?.destroy();
    };
  }, [bytes]);

  useEffect(() => {
    if (loading || !docRef.current) return;
    let cancelled = false;
    taskRef.current?.cancel();
    (async () => {
      try {
        const page = await docRef.current!.getPage(currentPage + 1);
        if (cancelled) { page.cleanup(); return; }
        const viewport = page.getViewport({ scale: 1 });
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        setPageSize({ width: viewport.width, height: viewport.height });
        // Intent sama dengan render hasil (pdfToImages): anotasi khusus cetak harus terlihat di sini
        // agar bisa ikut disensor — kalau tidak, ia lolos ke gambar hasil tanpa pernah terlihat.
        const task = page.render({ canvasContext: ctx, viewport, intent: 'print' });
        taskRef.current = task;
        await task.promise;
        page.cleanup();
      } catch { /* halaman gagal render — biarkan canvas sebelumnya */ }
    })();
    return () => { cancelled = true; };
  }, [loading, currentPage]);

  // Posisi pointer dalam poin halaman; canvas bisa dikecilkan CSS.
  const toPoint = (e: PointerEvent) => {
    const rect = layerRef.current!.getBoundingClientRect();
    const k = rect.width / pageSize.width;
    const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
    return { x: clamp((e.clientX - rect.left) / k, pageSize.width), y: clamp((e.clientY - rect.top) / k, pageSize.height) };
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toPoint(e);
    setDraft({ sx: p.x, sy: p.y, box: { x: p.x, y: p.y, w: 0, h: 0 } });
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!draft) return;
    const p = toPoint(e);
    setDraft({ ...draft, box: { x: Math.min(draft.sx, p.x), y: Math.min(draft.sy, p.y), w: Math.abs(p.x - draft.sx), h: Math.abs(p.y - draft.sy) } });
  };

  const onPointerUp = () => {
    if (draft && draft.box.w >= MIN_SIZE && draft.box.h >= MIN_SIZE) {
      const box = draft.box;
      setBoxes((prev) => ({ ...prev, [currentPage]: [...(prev[currentPage] ?? []), box] }));
    }
    setDraft(null);
  };

  const removeBox = (index: number) => setBoxes((prev) => ({ ...prev, [currentPage]: prev[currentPage].filter((_, i) => i !== index) }));

  const pageBoxes = boxes[currentPage] ?? [];
  const pagesWithBoxes = Object.values(boxes).filter((list) => list.length).length;
  const pct = (v: number, total: number) => `${total ? (v / total) * 100 : 0}%`;
  const place = (b: Box) => ({ left: pct(b.x, pageSize.width), top: pct(b.y, pageSize.height), width: pct(b.w, pageSize.width), height: pct(b.h, pageSize.height) });

  return (
    <div className="split-panel">
      <div className="annotate-preview-wrap">
        <div className="crop-canvas-wrap redact-wrap">
          <canvas ref={canvasRef} className="annotate-canvas-base" />
          {!loading && pageSize.width > 0 && (
            <div ref={layerRef} className="redact-layer" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => setDraft(null)}>
              {pageBoxes.map((b, i) => (
                <div key={i} className="redact-box" style={place(b)}>
                  <button type="button" className="redact-remove" onClick={() => removeBox(i)} aria-label={tr(`Hapus kotak sensor ${i + 1}`, `Remove redaction box ${i + 1}`)}>✕</button>
                </div>
              ))}
              {draft && <div className="redact-box is-draft" style={place(draft.box)} />}
            </div>
          )}
          {loading && <div className="annotate-loading">{tr('Memuat halaman…', 'Loading page…')}</div>}
        </div>

        {pageCount > 1 && (
          <div className="crop-page-nav">
            <button type="button" className="ghost-btn" disabled={currentPage === 0} onClick={() => setCurrentPage((p) => Math.max(0, p - 1))} aria-label={tr('Halaman sebelumnya', 'Previous page')}>‹</button>
            <span>{tr('Halaman', 'Page')} {currentPage + 1} / {pageCount}</span>
            <button type="button" className="ghost-btn" disabled={currentPage >= pageCount - 1} onClick={() => setCurrentPage((p) => Math.min(pageCount - 1, p + 1))} aria-label={tr('Halaman berikutnya', 'Next page')}>›</button>
          </div>
        )}

        <p className="annotate-caption">
          {tr(`${pageBoxes.length} kotak di halaman ini`, `${pageBoxes.length} box(es) on this page`)}{pagesWithBoxes > 0 && tr(` · ${pagesWithBoxes} halaman akan disensor`, ` · ${pagesWithBoxes} page(s) will be redacted`)}
        </p>
      </div>

      <p className="split-hint">{tr('Seret di halaman untuk menutup bagian yang ingin disensor. Halaman yang disensor diubah jadi gambar, jadi teks aslinya benar-benar hilang dan tidak bisa disalin. Tautan, komentar, formulir, dan bookmark tidak ikut ke hasil.', 'Drag on the page to cover what you want redacted. Redacted pages are turned into images, so the original text is truly gone and cannot be copied. Links, comments, forms, and bookmarks are not carried into the result.')}</p>
      <button className="primary" onClick={() => onProcess(boxes)} disabled={busy || loading || pagesWithBoxes === 0}>
        {busy ? tr('Memproses…', 'Processing…') : pagesWithBoxes > 0 ? tr(`Sensor ${pagesWithBoxes} halaman`, `Redact ${pagesWithBoxes} page(s)`) : tr('Sensor halaman', 'Redact pages')}
      </button>
    </div>
  );
}

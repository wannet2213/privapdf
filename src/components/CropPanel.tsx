import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PageViewer } from './PageViewer';
import {
  clampCropBox, boxFromMargins, marginsFromBox, presetRatio, resizeCropBox,
  type Box, type CropHandle, type Margins,
} from '../lib/crop-box';
import { tr } from '../lib/i18n';

GlobalWorkerOptions.workerSrc = workerUrl;

interface CropPanelProps {
  bytes: ArrayBuffer;
  onProcess: (opts: Record<string, unknown>) => void;
  busy: boolean;
}

const PREVIEW_SCALE = 1.0;

const PRESETS: { id: string; label: string; w?: number; h?: number }[] = [
  { id: 'free', label: tr('Bebas', 'Free') },
  { id: 'a4', label: 'A4', w: 595, h: 842 },
  { id: 'letter', label: 'Letter', w: 612, h: 792 },
];

const HANDLES: { id: CropHandle; x: string; y: string; cursor: string }[] = [
  { id: 'nw', x: '0%', y: '0%', cursor: 'nwse-resize' },
  { id: 'n', x: '50%', y: '0%', cursor: 'ns-resize' },
  { id: 'ne', x: '100%', y: '0%', cursor: 'nesw-resize' },
  { id: 'e', x: '100%', y: '50%', cursor: 'ew-resize' },
  { id: 'se', x: '100%', y: '100%', cursor: 'nwse-resize' },
  { id: 's', x: '50%', y: '100%', cursor: 'ns-resize' },
  { id: 'sw', x: '0%', y: '100%', cursor: 'nesw-resize' },
  { id: 'w', x: '0%', y: '50%', cursor: 'ew-resize' },
];

export function CropPanel({ bytes, onProcess, busy }: CropPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PDFDocumentProxy | undefined>(undefined);
  const taskRef = useRef<RenderTask | undefined>(undefined);
  const dragRef = useRef<{ handle: CropHandle; sx: number; sy: number; start: Box; k: number } | null>(null);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(true);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [activePreset, setActivePreset] = useState('free');
  /** Margin crop per halaman; halaman tanpa entri = tanpa pemotongan. */
  const [margins, setMargins] = useState<Record<number, Margins>>({});
  const [viewing, setViewing] = useState<number | null>(null);

  // Muat dokumen sekali
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise.then(async (doc) => {
      if (cancelled) { void doc.destroy(); return; }
      docRef.current = doc;
      setPageCount(doc.numPages);
      if (!cancelled) setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      taskRef.current?.cancel();
      docRef.current?.destroy();
    };
  }, [bytes]);

  // Render halaman aktif ke canvas pratinjau
  useEffect(() => {
    if (loading || !docRef.current) return;
    let cancelled = false;
    taskRef.current?.cancel();
    (async () => {
      const doc = docRef.current!;
      try {
        const page = await doc.getPage(currentPage + 1);
        if (cancelled) { page.cleanup(); return; }
        const viewport = page.getViewport({ scale: PREVIEW_SCALE });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        setPageSize({ width: viewport.width, height: viewport.height });
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const task = page.render({ canvasContext: ctx, viewport });
          taskRef.current = task;
          await task.promise;
        }
        page.cleanup();
      } catch { /* halaman gagal render — biarkan canvas sebelumnya */ }
    })();
    return () => { cancelled = true; };
  }, [loading, currentPage]);

  const ratio = presetRatio(activePreset);
  const currentBox = boxFromMargins(margins[currentPage], pageSize.width, pageSize.height);
  const isFull = Math.abs(currentBox.w - pageSize.width) < 1 && Math.abs(currentBox.h - pageSize.height) < 1;
  const croppedCount = Object.values(margins).filter((m) => m.top > 0.5 || m.bottom > 0.5 || m.left > 0.5 || m.right > 0.5).length;

  const setMarginsFor = (page: number, m: Margins | null) => {
    setMargins((prev) => {
      const next = { ...prev };
      if (!m) delete next[page];
      else next[page] = m;
      return next;
    });
  };

  const applyPreset = (presetId: string) => {
    setActivePreset(presetId);
    if (!pageSize.width) return;
    const r = presetRatio(presetId);
    if (!r) {
      // Bebas: kembalikan halaman ini ke seluruh halaman
      setMarginsFor(currentPage, null);
      return;
    }
    const preset = PRESETS.find((p) => p.id === presetId);
    let w = preset?.w ?? pageSize.width;
    let h = preset?.h ?? pageSize.height;
    if (w > pageSize.width) { w = pageSize.width; h = w / r; }
    if (h > pageSize.height) { h = pageSize.height; w = h * r; }
    const box = clampCropBox((pageSize.width - w) / 2, (pageSize.height - h) / 2, w, h, pageSize.width, pageSize.height, r);
    setMarginsFor(currentPage, marginsFromBox(box, pageSize.width, pageSize.height));
  };

  const applyToAll = () => {
    const m = margins[currentPage];
    if (!m) {
      setMargins({});
      return;
    }
    const all: Record<number, Margins> = {};
    for (let i = 0; i < pageCount; i++) all[i] = { ...m };
    setMargins(all);
  };

  // Faktor skala tampilan: CSS bisa mengecilkan canvas, ukur via bounding rect
  const displayFactor = () => {
    const rect = wrapRef.current?.getBoundingClientRect();
    return rect && pageSize.width ? rect.width / pageSize.width : 1;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>, handle: CropHandle) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { handle, sx: e.clientX, sy: e.clientY, start: { ...currentBox }, k: displayFactor() };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !pageSize.width) return;
    const dx = (e.clientX - drag.sx) / drag.k;
    const dy = (e.clientY - drag.sy) / drag.k;
    const nb = resizeCropBox(drag.start, drag.handle, dx, dy, pageSize.width, pageSize.height, ratio);
    setMarginsFor(currentPage, marginsFromBox(nb, pageSize.width, pageSize.height));
  };

  const endDrag = () => { dragRef.current = null; };

  const submit = () => {
    const pages = Object.entries(margins)
      .filter(([, m]) => m.top > 0.5 || m.bottom > 0.5 || m.left > 0.5 || m.right > 0.5)
      .map(([i, m]) => ({ index: Number(i), ...m }));
    if (!pages.length) return;
    onProcess({ pages });
  };

  // Geometri dalam persentase halaman agar presisi walau canvas dikecilkan CSS
  const pct = (v: number, total: number) => `${total ? (v / total) * 100 : 0}%`;

  return (
    <div className="split-panel">
      <div className="crop-presets">
        {PRESETS.map((p) => (
          <button key={p.id} className={`ghost-btn ${activePreset === p.id ? 'is-active' : ''}`} onClick={() => applyPreset(p.id)}>{p.label}</button>
        ))}
        {pageCount > 1 && (
          <button type="button" className="ghost-btn" onClick={applyToAll} title={tr('Salin pemotongan halaman ini ke semua halaman', 'Copy this page crop to every page')}>
            {tr('Terapkan ke semua', 'Apply to all')}
          </button>
        )}
      </div>

      <div className="annotate-preview-wrap">
        <div ref={wrapRef} className="crop-canvas-wrap" style={{ width: pageSize.width || 'auto' }}>
          <canvas ref={canvasRef} className="annotate-canvas-base" />
          {!loading && <button type="button" className="page-thumb-zoom annotate-zoom-btn" onClick={() => setViewing(currentPage)} aria-label={tr('Lihat halaman full', 'View full page')}>⤢</button>}
          {!loading && pageSize.width > 0 && (
            <div
              className="crop-shade"
              style={{ clipPath: `polygon(0 0, 0 100%, ${pct(currentBox.x, pageSize.width)} 100%, ${pct(currentBox.x, pageSize.width)} ${pct(currentBox.y, pageSize.height)}, ${pct(currentBox.x + currentBox.w, pageSize.width)} ${pct(currentBox.y, pageSize.height)}, ${pct(currentBox.x + currentBox.w, pageSize.width)} ${pct(currentBox.y + currentBox.h, pageSize.height)}, ${pct(currentBox.x, pageSize.width)} ${pct(currentBox.y + currentBox.h, pageSize.height)}, ${pct(currentBox.x, pageSize.width)} 100%, 100% 100%, 100% 0)` }}
            />
          )}
          {!loading && pageSize.width > 0 && (
            <div
              className={`crop-box ${dragRef.current ? 'is-active' : ''}`}
              style={{ left: pct(currentBox.x, pageSize.width), top: pct(currentBox.y, pageSize.height), width: pct(currentBox.w, pageSize.width), height: pct(currentBox.h, pageSize.height) }}
              onPointerDown={(e) => onPointerDown(e, 'move')}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {HANDLES.map((h) => (
                <div key={h.id} className="crop-handle" style={{ left: h.x, top: h.y, cursor: h.cursor }} onPointerDown={(e) => onPointerDown(e, h.id)} />
              ))}
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
          {tr(`Halaman ${currentPage + 1} dari ${pageCount}`, `Page ${currentPage + 1} of ${pageCount}`)} · {isFull ? tr('Tanpa pemotongan', 'No crop') : `${Math.round(currentBox.w)} × ${Math.round(currentBox.h)} pt`}
          {croppedCount > 0 && tr(` · ${croppedCount} halaman akan dipotong`, ` · ${croppedCount} page(s) will be cropped`)}
        </p>
      </div>

      <p className="split-hint">{tr('Setiap halaman bisa dipotong berbeda, gunakan ‹ › untuk pindah halaman, atau "Terapkan ke semua" untuk menyalin pemotongan halaman ini. ', 'Each page can be cropped differently, use ‹ › to switch pages, or "Apply to all" to copy this page crop. ')}{ratio ? tr('Rasio preset dikunci saat mengubah ukuran. ', 'The preset ratio stays locked while resizing. ') : ''}{tr('Area gelap akan dipotong.', 'The dark area will be cut off.')}</p>
      <button className="primary" onClick={submit} disabled={busy || loading || croppedCount === 0}>
        {busy ? tr('Memproses…', 'Processing…') : croppedCount > 0 ? tr(`Potong ${croppedCount} halaman`, `Crop ${croppedCount} page(s)`) : tr('Potong halaman', 'Crop pages')}
      </button>
      {viewing !== null && (
        <PageViewer
          bytes={bytes}
          pageNumber={viewing}
          totalPages={pageCount}
          onClose={() => setViewing(null)}
          onPageChange={setViewing}
          crop={{
            ratio,
            getMargins: (p) => margins[p] ?? null,
            setMargins: setMarginsFor,
          }}
        />
      )}
    </div>
  );
}

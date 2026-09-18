import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { boxFromMargins, isZeroMargins, marginsFromBox, resizeCropBox, type Box, type CropHandle, type Margins } from '../lib/crop-box';

GlobalWorkerOptions.workerSrc = workerUrl;

interface CropControl {
  /** Rasio w/h yang dikunci, atau null untuk bebas. */
  ratio: number | null;
  /** Margin crop halaman (indeks 0-based); null = tanpa crop. */
  getMargins: (page: number) => Margins | null;
  /** Simpan margin halaman; null berarti hapus crop (seluruh halaman). */
  setMargins: (page: number, m: Margins | null) => void;
}

interface PageViewerProps {
  bytes: ArrayBuffer;
  pageNumber: number;
  totalPages: number;
  onClose: () => void;
  onPageChange: (page: number) => void;
  overlayDraw?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  /** Jika diberikan, full view bisa memotong halaman secara interaktif. */
  crop?: CropControl;
}

const VIEWER_SCALE = 1.4;

const CROP_HANDLES: { id: CropHandle; x: string; y: string; cursor: string }[] = [
  { id: 'nw', x: '0%', y: '0%', cursor: 'nwse-resize' },
  { id: 'n', x: '50%', y: '0%', cursor: 'ns-resize' },
  { id: 'ne', x: '100%', y: '0%', cursor: 'nesw-resize' },
  { id: 'e', x: '100%', y: '50%', cursor: 'ew-resize' },
  { id: 'se', x: '100%', y: '100%', cursor: 'nwse-resize' },
  { id: 's', x: '50%', y: '100%', cursor: 'ns-resize' },
  { id: 'sw', x: '0%', y: '100%', cursor: 'nesw-resize' },
  { id: 'w', x: '0%', y: '50%', cursor: 'ew-resize' },
];

export function PageViewer({ bytes, pageNumber, totalPages, onClose, onPageChange, overlayDraw, crop }: PageViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<PDFDocumentProxy | undefined>(undefined);
  const taskRef = useRef<RenderTask | undefined>(undefined);
  const stackRef = useRef<HTMLDivElement>(null);
  const cropDragRef = useRef<{ handle: CropHandle; sx: number; sy: number; start: Box; k: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  /** Ukuran halaman dalam point PDF (viewport scale 1). */
  const [pagePts, setPagePts] = useState({ w: 0, h: 0 });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise
      .then((doc) => {
        if (cancelled) { void doc.destroy(); return; }
        docRef.current = doc;
        setLoading(false);
      })
      .catch(() => { if (!cancelled) { setError('Gagal memuat dokumen.'); setLoading(false); } });
    return () => {
      cancelled = true;
      taskRef.current?.cancel();
      docRef.current?.destroy();
    };
  }, [bytes]);

  useEffect(() => {
    if (loading || error || !docRef.current || !canvasRef.current) return;
    let cancelled = false;
    taskRef.current?.cancel();
    const render = async () => {
      const doc = docRef.current;
      const canvas = canvasRef.current;
      if (!doc || !canvas) return;
      try {
        const page: PDFPageProxy = await doc.getPage(pageNumber + 1);
        if (cancelled) { page.cleanup(); return; }
        const viewport = page.getViewport({ scale: VIEWER_SCALE });
        const base = page.getViewport({ scale: 1 });
        setPagePts({ w: base.width, h: base.height });
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas tidak tersedia.');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const task = page.render({ canvasContext: ctx, viewport });
        taskRef.current = task;
        await task.promise;
        page.cleanup();
        if (!cancelled && overlayDraw && overlayRef.current) {
          overlayRef.current.width = canvas.width;
          overlayRef.current.height = canvas.height;
          const overlayCtx = overlayRef.current.getContext('2d');
          if (overlayCtx) overlayDraw(overlayCtx, canvas.width, canvas.height);
        }
      } catch (reason) {
        if (!cancelled && !(reason instanceof Error && reason.name === 'RenderingCancelledException')) {
          setError('Gagal merender halaman.');
        }
      }
    };
    void render();
    return () => { cancelled = true; };
  }, [loading, error, pageNumber, overlayDraw]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && pageNumber > 0) onPageChange(pageNumber - 1);
      else if (e.key === 'ArrowRight' && pageNumber < totalPages - 1) onPageChange(pageNumber + 1);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [pageNumber, totalPages, onClose, onPageChange]);

  // ===== Crop interaktif (opsional) =====
  const cropFactor = () => {
    const rect = stackRef.current?.getBoundingClientRect();
    return rect && pagePts.w ? rect.width / pagePts.w : 1;
  };

  /** Kotak crop halaman yang sedang dilihat (margin null → seluruh halaman). */
  const cropBox: Box = crop && pagePts.w > 0
    ? boxFromMargins(crop.getMargins(pageNumber), pagePts.w, pagePts.h)
    : { x: 0, y: 0, w: 0, h: 0 };

  const onCropPointerDown = (e: PointerEvent<HTMLDivElement>, handle: CropHandle) => {
    if (!crop || !pagePts.w) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    cropDragRef.current = { handle, sx: e.clientX, sy: e.clientY, start: { ...cropBox }, k: cropFactor() };
  };

  const onCropPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = cropDragRef.current;
    if (!crop || !drag || !pagePts.w) return;
    const dx = (e.clientX - drag.sx) / drag.k;
    const dy = (e.clientY - drag.sy) / drag.k;
    const nb = resizeCropBox(drag.start, drag.handle, dx, dy, pagePts.w, pagePts.h, crop.ratio);
    const m = marginsFromBox(nb, pagePts.w, pagePts.h);
    crop.setMargins(pageNumber, isZeroMargins(m, 0.5) ? null : m);
  };

  const endCropDrag = () => { cropDragRef.current = null; };

  const pct = (v: number, total: number) => `${total ? (v / total) * 100 : 0}%`;

  return (
    <div className="page-viewer-overlay" onClick={onClose}>
      <div className="page-viewer" onClick={(e) => e.stopPropagation()}>
        <div className="page-viewer-bar">
          <button className="page-viewer-nav" disabled={pageNumber === 0} onClick={() => onPageChange(pageNumber - 1)} aria-label="Halaman sebelumnya">‹</button>
          <span className="page-viewer-count">{pageNumber + 1} / {totalPages}</span>
          <button className="page-viewer-nav" disabled={pageNumber >= totalPages - 1} onClick={() => onPageChange(pageNumber + 1)} aria-label="Halaman berikutnya">›</button>
          {crop && <span className="page-viewer-crop-hint">Mode potong aktif, seret kotak</span>}
          <button className="page-viewer-close" onClick={onClose} aria-label="Tutup">✕</button>
        </div>
        <div className="page-viewer-canvas-wrap">
          {loading && <div className="page-viewer-loading">Memuat dokumen…</div>}
          {error && <div className="page-viewer-error">{error}</div>}
          <div className="page-viewer-stack" ref={stackRef}>
            <canvas ref={canvasRef} className="page-viewer-canvas" />
            {overlayDraw && <canvas ref={overlayRef} className="page-viewer-canvas page-viewer-overlay-canvas" />}
            {crop && pagePts.w > 0 && (
              <div className="crop-layer">
                <div
                  className="crop-shade"
                  style={{ clipPath: `polygon(0 0, 0 100%, ${pct(cropBox.x, pagePts.w)} 100%, ${pct(cropBox.x, pagePts.w)} ${pct(cropBox.y, pagePts.h)}, ${pct(cropBox.x + cropBox.w, pagePts.w)} ${pct(cropBox.y, pagePts.h)}, ${pct(cropBox.x + cropBox.w, pagePts.w)} ${pct(cropBox.y + cropBox.h, pagePts.h)}, ${pct(cropBox.x, pagePts.w)} ${pct(cropBox.y + cropBox.h, pagePts.h)}, ${pct(cropBox.x, pagePts.w)} 100%, 100% 100%, 100% 0)` }}
                />
                <div
                  className={`crop-box ${cropDragRef.current ? 'is-active' : ''}`}
                  style={{ left: pct(cropBox.x, pagePts.w), top: pct(cropBox.y, pagePts.h), width: pct(cropBox.w, pagePts.w), height: pct(cropBox.h, pagePts.h) }}
                  onPointerDown={(e) => onCropPointerDown(e, 'move')}
                  onPointerMove={onCropPointerMove}
                  onPointerUp={endCropDrag}
                  onPointerCancel={endCropDrag}
                >
                  {CROP_HANDLES.map((h) => (
                    <div key={h.id} className="crop-handle" style={{ left: h.x, top: h.y, cursor: h.cursor }} onPointerDown={(e) => onCropPointerDown(e, h.id)} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

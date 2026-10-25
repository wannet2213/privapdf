import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PageViewer } from './PageViewer';
import { tr } from '../lib/i18n';

GlobalWorkerOptions.workerSrc = workerUrl;

interface RotatePanelProps {
  bytes: ArrayBuffer;
  pageCount: number;
  onProcess: (opts: Record<string, unknown>) => void;
  busy: boolean;
}

const PREVIEW_SCALE = 1.0;

/** Rotasi tambahan per halaman yang dipilih (relatif, diakumulasikan di UI). */
type Angle = 90 | 180 | 270;

export function RotatePanel({ bytes, pageCount, onProcess, busy }: RotatePanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PDFDocumentProxy | undefined>(undefined);
  const taskRef = useRef<RenderTask | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  /** Rotasi relatif per halaman (derajat, 0/90/180/270). */
  const [rotations, setRotations] = useState<Record<number, number>>({});
  const [viewing, setViewing] = useState<number | null>(null);
  /** Rotasi aktif (derajat) untuk halaman yang sedang ditampilkan. */
  const currentRot = ((rotations[currentPage] ?? 0) % 360 + 360) % 360;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise.then(async (doc) => {
      if (cancelled) { void doc.destroy(); return; }
      docRef.current = doc;
      if (!cancelled) setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      taskRef.current?.cancel();
      docRef.current?.destroy();
    };
  }, [bytes]);

  // Render halaman aktif dengan rotasi bawaan pdf.js agar dimensi canvas
  // (portrait/landscape) ikut menyesuaikan saat halaman diputar 90°/270°.
  useEffect(() => {
    if (loading || !docRef.current) return;
    let cancelled = false;
    taskRef.current?.cancel();
    (async () => {
      const doc = docRef.current!;
      try {
        const page = await doc.getPage(currentPage + 1);
        if (cancelled) { page.cleanup(); return; }
        const viewport = page.getViewport({ scale: PREVIEW_SCALE, rotation: currentRot });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const task = page.render({ canvasContext: ctx, viewport });
          taskRef.current = task;
          await task.promise;
        }
        page.cleanup();
      } catch { /* biarkan canvas sebelumnya */ }
    })();
    return () => { cancelled = true; };
  }, [loading, currentPage, currentRot]);

  const rotatedCount = Object.values(rotations).filter((a) => a % 360 !== 0).length;

  const setRotation = (delta: number) => {
    setRotations((prev) => {
      const next = { ...prev };
      const cur = next[currentPage] ?? 0;
      const nv = (((cur + delta) % 360) + 360) % 360;
      if (nv === 0) delete next[currentPage];
      else next[currentPage] = nv;
      return next;
    });
  };

  const resetPage = () => {
    setRotations((prev) => {
      const next = { ...prev };
      delete next[currentPage];
      return next;
    });
  };

  const resetAll = () => setRotations({});

  const submit = () => {
    const pages = Object.entries(rotations)
      .map(([i, a]) => ({ index: Number(i), angle: a }))
      .filter((e) => e.angle % 360 !== 0);
    if (!pages.length) return;
    onProcess({ pages });
  };

  const label = (a: number) => {
    switch (a) {
      case 90: return tr('90° kanan', '90° right');
      case 180: return '180°';
      case 270: return tr('90° kiri', '90° left');
      default: return '0°';
    }
  };

  // Rotasi ditangani langsung oleh pdf.js saat render (lihat viewport rotation di atas),
  // sehingga dimensi canvas otomatis mengikuti orientasi halaman.

  return (
    <div className="split-panel">
      <div className="annotate-preview-wrap">
        <div ref={wrapRef} className="rotate-canvas-wrap">
          <canvas
            ref={canvasRef}
            className="annotate-canvas-base rotate-canvas"
          />
          {!loading && <button type="button" className="page-thumb-zoom annotate-zoom-btn" onClick={() => setViewing(currentPage)} aria-label={tr('Lihat halaman full', 'View full page')}>⤢</button>}
          {!loading && (
            <span className="rotate-degree-badge">{label(currentRot)}</span>
          )}
          {loading && <div className="annotate-loading">{tr('Memuat halaman…', 'Loading page…')}</div>}
        </div>

        {pageCount > 1 && (
          <div className="crop-page-nav">
            <button type="button" className="ghost-btn" disabled={currentPage === 0} onClick={() => setCurrentPage((p) => Math.max(0, p - 1))} aria-label={tr('Halaman sebelumnya', 'Previous page')}>‹</button>
            <span>
              {tr('Halaman', 'Page')} {currentPage + 1} / {pageCount}
              {(rotations[currentPage] ?? 0) % 360 !== 0 && <b className="rotate-page-mark"> · {tr('diputar', 'rotated')} {label(currentRot)}</b>}
            </span>
            <button type="button" className="ghost-btn" disabled={currentPage >= pageCount - 1} onClick={() => setCurrentPage((p) => Math.min(pageCount - 1, p + 1))} aria-label={tr('Halaman berikutnya', 'Next page')}>›</button>
          </div>
        )}

        <p className="annotate-caption">
          {tr(`Halaman ${currentPage + 1} dari ${pageCount} · arah putaran saat ini: `, `Page ${currentPage + 1} of ${pageCount} · current rotation: `)}{label(currentRot)}
          {rotatedCount > 0 && tr(` · ${rotatedCount} halaman akan diputar`, ` · ${rotatedCount} page(s) will be rotated`)}
        </p>
      </div>

      <div className="rotate-controls">
        <button type="button" className="rotate-btn" onClick={() => setRotation(-90)} disabled={busy}>
          <span className="rotate-icon">↺</span> {tr('90° kiri', '90° left')}
        </button>
        <button type="button" className="rotate-btn" onClick={() => setRotation(180)} disabled={busy}>
          <span className="rotate-icon">⇅</span> 180°
        </button>
        <button type="button" className="rotate-btn" onClick={() => setRotation(90)} disabled={busy}>
          <span className="rotate-icon">↻</span> {tr('90° kanan', '90° right')}
        </button>
      </div>
      <div className="rotate-controls secondary">
        <button type="button" className="ghost-btn" onClick={resetPage} disabled={busy}>{tr('Reset halaman ini', 'Reset this page')}</button>
        <button type="button" className="ghost-btn" onClick={resetAll} disabled={busy || rotatedCount === 0}>{tr('Reset semua', 'Reset all')}</button>
      </div>

      <p className="split-hint">{tr('Pratinjau berputar real-time saat tombol arah ditekan. Putaran bisa berbeda tiap halaman, navigasi dengan ‹ ›. Diterapkan ke sudut halaman yang sudah ada (relatif).', 'The preview rotates live as you press a direction. Each page can have its own rotation, navigate with ‹ ›. Applied on top of the existing page angle (relative).')}</p>
      <button className="primary" onClick={submit} disabled={busy || loading || rotatedCount === 0}>
        {busy ? tr('Memproses…', 'Processing…') : rotatedCount > 0 ? tr(`Putar ${rotatedCount} halaman`, `Rotate ${rotatedCount} page(s)`) : tr('Putar halaman', 'Rotate pages')}
      </button>
      {viewing !== null && (
        <PageViewer bytes={bytes} pageNumber={viewing} totalPages={pageCount} onClose={() => setViewing(null)} onPageChange={setViewing} />
      )}
    </div>
  );
}

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PageViewer } from '../components/PageViewer';

GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_PREVIEW_BYTES = 100 * 1024 * 1024;
const MAX_PREVIEW_PAGES = 200;
const PREVIEW_SCALE = 0.28;
const INITIAL_RENDER_COUNT = 8;
const DRAG_THRESHOLD = 5;

type PreviewPage = { page: number; label: string };
type PdfPreviewProps = { bytes: ArrayBuffer; pages: PreviewPage[]; selected: number[]; onToggle: (page: number) => void; onMove: (from: number, to: number) => void };

export function PdfPreview({ bytes, pages, selected, onToggle, onMove }: PdfPreviewProps) {
  const canvases = useRef(new Map<number, HTMLCanvasElement>());
  const cards = useRef(new Map<number, HTMLElement>());
  const documentRef = useRef<PDFDocumentProxy | undefined>(undefined);
  const tasks = useRef(new Map<number, RenderTask>());
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [rendered, setRendered] = useState<Set<number>>(new Set());
  const [viewing, setViewing] = useState<number | null>(null);

  // Pointer state
  const downRef = useRef<{ index: number; x: number; y: number; pointerId: number } | null>(null);
  const draggingRef = useRef<number | null>(null);
  const overIndexRef = useRef<number | null>(null);
  const capturedRef = useRef(false);
  const didDragAtRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setError(undefined); setLoaded(false); setRendered(new Set());
    const loading = bytes.byteLength <= MAX_PREVIEW_BYTES ? getDocument({ data: new Uint8Array(bytes.slice(0)) }) : undefined;
    if (!loading) { setError('PDF terlalu besar untuk preview (maksimal 100 MB).'); return; }
    loading.promise.then((pdf) => {
      if (cancelled) { void pdf.destroy(); return; }
      if (pdf.numPages > MAX_PREVIEW_PAGES) { setError('PDF memiliki terlalu banyak halaman untuk preview.'); void pdf.destroy(); return; }
      documentRef.current = pdf; setLoaded(true);
    }).catch(() => { if (!cancelled) setError('PDF tidak valid atau rusak.'); });
    return () => { cancelled = true; tasks.current.forEach((task) => task.cancel()); tasks.current.clear(); documentRef.current?.destroy(); documentRef.current = undefined; canvases.current.forEach((canvas) => { canvas.width = 0; canvas.height = 0; }); canvases.current.clear(); cards.current.clear(); };
  }, [bytes]);

  useEffect(() => {
    if (!loaded || !documentRef.current) return;
    let cancelled = false;
    const render = async (item: PreviewPage) => {
      const pdf = documentRef.current; const canvas = canvases.current.get(item.page);
      if (!pdf || !canvas || rendered.has(item.page) || tasks.current.has(item.page)) return;
      try {
        const page: PDFPageProxy = await pdf.getPage(item.page + 1);
        if (cancelled) { page.cleanup(); return; }
        const viewport = page.getViewport({ scale: PREVIEW_SCALE });
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas preview tidak tersedia di browser ini.');
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const task = page.render({ canvasContext: context, viewport }); tasks.current.set(item.page, task);
        await task.promise; tasks.current.delete(item.page); page.cleanup();
        if (!cancelled) setRendered((current) => new Set(current).add(item.page));
      } catch (reason) { tasks.current.delete(item.page); if (!cancelled && !(reason instanceof Error && reason.name === 'RenderingCancelledException')) setError(reason instanceof Error ? reason.message : 'Preview PDF gagal dirender.'); }
    };
    const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { const page = Number((entry.target as HTMLElement).dataset.pageNumber); const item = pages.find((candidate) => candidate.page === page); if (item) void render(item); } }), { rootMargin: '300px' });
    cards.current.forEach((card) => observer?.observe(card));
    pages.slice(0, INITIAL_RENDER_COUNT).forEach((item) => void render(item));
    return () => { cancelled = true; observer?.disconnect(); };
  }, [loaded, pages, rendered]);

  const cleanup = () => {
    downRef.current = null;
    draggingRef.current = null;
    overIndexRef.current = null;
    capturedRef.current = false;
    setDragging(null);
    setOver(null);
  };

  const handlePointerDown = (event: PointerEvent<HTMLElement>, index: number) => {
    // Abaikan jika klik di interaktif elements
    if ((event.target as HTMLElement).closest('button, input, label, .page-thumb-zoom')) return;
    downRef.current = { index, x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    // Tangkap pointer sejak awal agar event drag tetap terkirim ke kartu ini.
    // Di iOS Safari, menangkap pointer setelah gerakan dimulai bisa memicu pointercancel
    // sehingga drag tidak pernah berjalan di layar sentuh.
    if (!capturedRef.current) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
        capturedRef.current = true;
      } catch { /* ignore */ }
    }
  };

  const handleThumbClick = (pageNumber: number) => {
    // Suppress click yang terjadi tepat setelah drag
    if (Date.now() - didDragAtRef.current < 300) return;
    setViewing(pageNumber);
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const down = downRef.current;
    if (!down) return;

    const dx = event.clientX - down.x;
    const dy = event.clientY - down.y;

    // Deteksi mulai drag (lewati threshold)
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

    // Sedang drag: update posisi drop target
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-page-index]');
    const targetIndex = target ? Number(target.dataset.pageIndex) : null;
    const next = targetIndex !== null && Number.isInteger(targetIndex) ? targetIndex : null;
    overIndexRef.current = next;
    setOver(next);
  };

  const handlePointerUp = (event: PointerEvent<HTMLElement>, index: number) => {
    const down = downRef.current;
    if (!down) { cleanup(); return; }
    if (draggingRef.current !== null) {
      const target = overIndexRef.current ?? index;
      if (draggingRef.current !== target) onMove(draggingRef.current, target);
    }
    cleanup();
  };

  if (error) return <div className="preview-error" role="alert">{error}</div>;

  return <div className="preview-grid" aria-busy={!loaded}>
    {pages.map((page, index) => <article key={page.page} ref={(card) => { if (card) cards.current.set(page.page, card); else cards.current.delete(page.page); }} data-page-index={index} data-page-number={page.page} className={`page-card ${over === index ? 'drop-target' : ''} ${dragging === index ? 'is-dragging' : ''}`} onPointerDown={(e) => handlePointerDown(e, index)} onPointerMove={handlePointerMove} onPointerEnter={() => { if (draggingRef.current !== null) { overIndexRef.current = index; setOver(index); } }} onPointerUp={(e) => handlePointerUp(e, index)} onPointerCancel={cleanup} onLostPointerCapture={cleanup}>
      <div className="page-thumb" onClick={() => handleThumbClick(page.page)}>
        <canvas ref={(canvas) => { if (canvas) canvases.current.set(page.page, canvas); else canvases.current.delete(page.page); }} aria-label={`Preview ${page.label}`} />{!rendered.has(page.page) && <span className="preview-loading" aria-hidden="true">…</span>}
        <span className="page-thumb-zoom" aria-hidden="true">⤢</span>
      </div>
      <label><input type="checkbox" checked={selected.includes(page.page)} onChange={() => onToggle(page.page)} />{page.label}</label>
      <div className="reorder-buttons"><button type="button" aria-label={`Naikkan halaman ${page.page + 1}`} disabled={index === 0} onClick={() => onMove(index, index - 1)}>↑</button><button type="button" aria-label={`Turunkan halaman ${page.page + 1}`} disabled={index === pages.length - 1} onClick={() => onMove(index, index + 1)}>↓</button></div>
    </article>)}
    {viewing !== null && documentRef.current && (
      <PageViewer bytes={bytes} pageNumber={viewing} totalPages={documentRef.current.numPages} onClose={() => setViewing(null)} onPageChange={setViewing} />
    )}
  </div>;
}

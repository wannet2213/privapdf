import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PageViewer } from '../components/PageViewer';
import { useDragSort } from './use-drag-sort';
import { tr } from './i18n';

GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_PREVIEW_BYTES = 100 * 1024 * 1024;
const MAX_PREVIEW_PAGES = 200;
const PREVIEW_SCALE = 0.28;
const INITIAL_RENDER_COUNT = 8;

type PreviewPage = { page: number; label: string };
type PdfPreviewProps = { bytes: ArrayBuffer; pages: PreviewPage[]; selected: number[]; onToggle: (page: number) => void; onMove: (from: number, to: number) => void };

export function PdfPreview({ bytes, pages, selected, onToggle, onMove }: PdfPreviewProps) {
  const canvases = useRef(new Map<number, HTMLCanvasElement>());
  const cards = useRef(new Map<number, HTMLElement>());
  const documentRef = useRef<PDFDocumentProxy | undefined>(undefined);
  const tasks = useRef(new Map<number, RenderTask>());
  const [error, setError] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [rendered, setRendered] = useState<Set<number>>(new Set());
  const [viewing, setViewing] = useState<number | null>(null);
  // Drag urutan: mouse = langsung, sentuh = tahan dulu (lihat useDragSort).
  const drag = useDragSort('[data-page-index]', 'pageIndex', onMove);
  const dragging = drag.dragging;
  const over = drag.over;

  useEffect(() => {
    let cancelled = false;
    setError(undefined); setLoaded(false); setRendered(new Set());
    const loading = bytes.byteLength <= MAX_PREVIEW_BYTES ? getDocument({ data: new Uint8Array(bytes.slice(0)) }) : undefined;
    if (!loading) { setError(tr('PDF terlalu besar untuk preview (maksimal 100 MB).', 'PDF is too large to preview (max 100 MB).')); return; }
    loading.promise.then((pdf) => {
      if (cancelled) { void pdf.destroy(); return; }
      if (pdf.numPages > MAX_PREVIEW_PAGES) { setError(tr('PDF memiliki terlalu banyak halaman untuk preview.', 'The PDF has too many pages to preview.')); void pdf.destroy(); return; }
      documentRef.current = pdf; setLoaded(true);
    }).catch(() => { if (!cancelled) setError(tr('PDF tidak valid atau rusak.', 'The PDF is invalid or damaged.')); });
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
        if (!context) throw new Error(tr('Canvas preview tidak tersedia di browser ini.', 'Preview canvas is not available in this browser.'));
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const task = page.render({ canvasContext: context, viewport }); tasks.current.set(item.page, task);
        await task.promise; tasks.current.delete(item.page); page.cleanup();
        if (!cancelled) setRendered((current) => new Set(current).add(item.page));
      } catch (reason) { tasks.current.delete(item.page); if (!cancelled && !(reason instanceof Error && reason.name === 'RenderingCancelledException')) setError(reason instanceof Error ? reason.message : tr('Preview PDF gagal dirender.', 'Failed to render the PDF preview.')); }
    };
    const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { const page = Number((entry.target as HTMLElement).dataset.pageNumber); const item = pages.find((candidate) => candidate.page === page); if (item) void render(item); } }), { rootMargin: '300px' });
    cards.current.forEach((card) => observer?.observe(card));
    pages.slice(0, INITIAL_RENDER_COUNT).forEach((item) => void render(item));
    return () => { cancelled = true; observer?.disconnect(); };
  }, [loaded, pages, rendered]);

  const handleThumbClick = (pageNumber: number) => {
    // Suppress click yang terjadi tepat setelah drag
    if (Date.now() - drag.didDragAt() < 300) return;
    setViewing(pageNumber);
  };

  if (error) return <div className="preview-error" role="alert">{error}</div>;

  return <div className="preview-grid" aria-busy={!loaded}>
    {pages.map((page, index) => <article key={page.page} ref={(card) => { if (card) cards.current.set(page.page, card); else cards.current.delete(page.page); }} data-page-index={index} data-page-number={page.page} className={`page-card ${over === index ? 'drop-target' : ''} ${dragging === index ? 'is-dragging' : ''}`} onPointerDown={(e) => { if ((e.target as HTMLElement).closest('button, input, label, .page-thumb-zoom')) return; drag.onPointerDown(e, index); }} onPointerMove={drag.onPointerMove} onPointerEnter={() => drag.onPointerEnter(index)} onPointerUp={() => drag.onPointerUp(index)} onPointerCancel={drag.cancel} onLostPointerCapture={drag.cancel} onContextMenu={(e) => e.preventDefault()}>
      <div className="page-thumb" onClick={() => handleThumbClick(page.page)}>
        <canvas ref={(canvas) => { if (canvas) canvases.current.set(page.page, canvas); else canvases.current.delete(page.page); }} aria-label={`Preview ${page.label}`} />{!rendered.has(page.page) && <span className="preview-loading" aria-hidden="true">…</span>}
        <span className="page-thumb-zoom" aria-hidden="true">⤢</span>
      </div>
      <label><input type="checkbox" checked={selected.includes(page.page)} onChange={() => onToggle(page.page)} />{page.label}</label>
      <div className="reorder-buttons"><button type="button" aria-label={tr(`Naikkan halaman ${page.page + 1}`, `Move page ${page.page + 1} up`)} disabled={index === 0} onClick={() => onMove(index, index - 1)}>↑</button><button type="button" aria-label={tr(`Turunkan halaman ${page.page + 1}`, `Move page ${page.page + 1} down`)} disabled={index === pages.length - 1} onClick={() => onMove(index, index + 1)}>↓</button></div>
    </article>)}
    {viewing !== null && documentRef.current && (
      <PageViewer bytes={bytes} pageNumber={viewing} totalPages={documentRef.current.numPages} onClose={() => setViewing(null)} onPageChange={setViewing} />
    )}
  </div>;
}

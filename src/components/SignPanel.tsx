import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { stampImage, type StampOptions } from '../engines/pdf-native';

GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_PREVIEW_BYTES = 100 * 1024 * 1024;
const MAX_PREVIEW_PAGES = 200;
const INK_COLORS = ['#1D2029', '#1D4ED8', '#D92E29'];
const WIDTHS = [
  { label: 'Tipis', px: 3 },
  { label: 'Sedang', px: 5 },
  { label: 'Tebal', px: 8 },
];

interface Stroke {
  color: string;
  width: number;
  points: Array<{ x: number; y: number }>;
}

interface SignPanelProps {
  bytes: ArrayBuffer;
  onProcess: (placement: StampOptions) => void;
  busy: boolean;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function SignPanel({ bytes, onProcess, busy }: SignPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pageCanvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PDFDocumentProxy | undefined>(undefined);
  const renderTaskRef = useRef<RenderTask | undefined>(undefined);
  const drawingRef = useRef(false);
  const dragRef = useRef<{ px: number; py: number; x0: number; y0: number } | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [ink, setInk] = useState(INK_COLORS[0]);
  const [thickness, setThickness] = useState(WIDTHS[1].px);
  const [stamp, setStamp] = useState<{ bytes: ArrayBuffer; type: 'png' | 'jpg'; src: string } | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [allPages, setAllPages] = useState(false);
  const [pos, setPos] = useState({ xPct: 55, yPct: 65, widthPct: 30, opacity: 1 });
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string>();

  // Muat dokumen untuk pratinjau penempatan (salin buffer — pdf.js bisa melepas buffer aslinya).
  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    if (bytes.byteLength > MAX_PREVIEW_BYTES) { setError('PDF terlalu besar untuk pratinjau (maksimal 100 MB).'); return; }
    getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise.then((pdf) => {
      if (cancelled) { void pdf.destroy(); return; }
      if (pdf.numPages > MAX_PREVIEW_PAGES) { setError(`Terlalu banyak halaman (${pdf.numPages}).`); void pdf.destroy(); return; }
      docRef.current = pdf;
      setPageCount(pdf.numPages);
    }).catch(() => { if (!cancelled) setError('PDF tidak valid atau rusak.'); });
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      void docRef.current?.destroy();
      docRef.current = undefined;
    };
  }, [bytes]);

  // Render halaman aktif ke kanvas pratinjau.
  useEffect(() => {
    if (!stamp || !docRef.current) return;
    let cancelled = false;
    setRendering(true);
    (async () => {
      try {
        const pdf = docRef.current;
        const canvas = pageCanvasRef.current;
        if (!pdf || !canvas) return;
        const page = await pdf.getPage(pageIndex + 1);
        if (cancelled) { page.cleanup(); return; }
        const viewport = page.getViewport({ scale: 2 });
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D tidak tersedia di browser ini.');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const task = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;
        if (!cancelled) setRendering(false);
      } catch (reason) {
        if (!cancelled && !(reason instanceof Error && reason.name === 'RenderingCancelledException')) {
          setError('Pratinjau gagal dirender.');
          setRendering(false);
        }
      }
    })();
    return () => { cancelled = true; renderTaskRef.current?.cancel(); };
  }, [stamp, pageIndex]);

  // Gambar ulang seluruh goresan (juga setelah clear/undo).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of strokes) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      s.points.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
      if (s.points.length === 1) ctx.lineTo(s.points[0].x + 0.1, s.points[0].y);
      ctx.stroke();
    }
  }, [strokes]);

  const canvasPoint = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const onDrawDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    setStrokes((prev) => [...prev, { color: ink, width: thickness, points: [canvasPoint(e)] }]);
  };

  const onDrawMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const pt = canvasPoint(e);
    setStrokes((prev) => {
      const next = prev.slice();
      const last = next[next.length - 1];
      if (last) last.points.push(pt);
      return next;
    });
  };

  const onDrawEnd = () => { drawingRef.current = false; };

  const useDrawing = () => {
    const canvas = canvasRef.current;
    if (!canvas || !strokes.length) return;
    canvas.toBlob(async (blob) => {
      if (!blob) { setError('Gagal membuat gambar tanda tangan.'); return; }
      setStamp({ bytes: await blob.arrayBuffer(), type: 'png', src: canvas.toDataURL('image/png') });
    }, 'image/png');
  };

  const onUpload = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') { setError('Gunakan gambar PNG atau JPEG.'); return; }
    try {
      const imageBytes = await file.arrayBuffer();
      const src = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Gagal membaca gambar.'));
        reader.readAsDataURL(file);
      });
      setStamp({ bytes: imageBytes, type: file.type === 'image/png' ? 'png' : 'jpg', src });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal membaca gambar.');
    }
  };

  const onOverlayDown = (e: ReactPointerEvent<HTMLImageElement>) => {
    e.preventDefault();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { px: e.clientX, py: e.clientY, x0: pos.xPct, y0: pos.yPct };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onOverlayMove = (e: ReactPointerEvent<HTMLImageElement>) => {
    const d = dragRef.current;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!d || !rect) return;
    const dxPct = ((e.clientX - d.px) / rect.width) * 100;
    const dyPct = ((e.clientY - d.py) / rect.height) * 100;
    setPos((p) => ({ ...p, xPct: clamp(d.x0 + dxPct, 0, 100 - p.widthPct), yPct: clamp(d.y0 + dyPct, 0, 100) }));
  };

  const onOverlayUp = () => { dragRef.current = null; };

  const apply = () => {
    if (!stamp) return;
    onProcess({
      imageBytes: stamp.bytes,
      imageType: stamp.type,
      pages: allPages ? Array.from({ length: pageCount }, (_, i) => i) : [pageIndex],
      xPct: pos.xPct,
      yPct: pos.yPct,
      widthPct: pos.widthPct,
      opacity: pos.opacity,
    });
  };

  if (error) return <div className="preview-error" role="alert">{error}</div>;

  return (
    <div className="split-panel">
      <div className="preview-heading">
        <span>Tanda tangan / stempel</span>
        <small>{stamp ? 'Seret gambar untuk memindahkan, atur ukuran, lalu tempel' : 'Gambar tanda tangan dengan tangan atau unggah gambar stempel'}</small>
      </div>

      {!stamp ? (
        <>
          <div className="sign-toolbar">
            <span className="tool-form-label">Tinta:</span>
            {INK_COLORS.map((c) => (
              <button key={c} type="button" aria-label={`Warna tinta ${c}`} className={`sign-swatch ${ink === c ? 'is-active' : ''}`} style={{ background: c }} onClick={() => setInk(c)} />
            ))}
            {WIDTHS.map((w) => (
              <button key={w.px} type="button" className={`sign-width ${thickness === w.px ? 'is-active' : ''}`} onClick={() => setThickness(w.px)}>{w.label}</button>
            ))}
            <button type="button" className="ghost-btn" onClick={() => setStrokes((prev) => prev.slice(0, -1))} disabled={!strokes.length}>Batal goresan</button>
            <button type="button" className="ghost-btn" onClick={() => setStrokes([])} disabled={!strokes.length}>Bersihkan</button>
          </div>
          <canvas ref={canvasRef} width={900} height={360} className="sign-canvas"
            onPointerDown={onDrawDown} onPointerMove={onDrawMove} onPointerUp={onDrawEnd} onPointerCancel={onDrawEnd} />
          <div className="sign-toolbar">
            <button className="primary" onClick={useDrawing} disabled={!strokes.length}>Gunakan tanda tangan →</button>
            <label className="ghost-btn sign-upload">Unggah gambar stempel (PNG/JPG)
              <input hidden type="file" accept="image/png,image/jpeg" onChange={(e) => { void onUpload(e.target.files); e.target.value = ''; }} />
            </label>
          </div>
        </>
      ) : (
        <>
          <div className="sign-toolbar">
            <button className="ghost-btn" onClick={() => setPageIndex((p) => Math.max(0, p - 1))} disabled={pageIndex === 0 || rendering}>←</button>
            <span className="sign-page-indicator">Halaman {pageIndex + 1} / {pageCount}</span>
            <button className="ghost-btn" onClick={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))} disabled={pageIndex >= pageCount - 1 || rendering}>→</button>
            <label className="sign-all-label">
              <input type="checkbox" checked={allPages} onChange={(e) => setAllPages(e.target.checked)} />
              Semua halaman
            </label>
            <button className="ghost-btn" onClick={() => setStamp(null)} disabled={busy}>Ganti gambar</button>
          </div>
          <div className="sign-stage" ref={stageRef}>
            <canvas ref={pageCanvasRef} className="sign-page" />
            {rendering && <span className="preview-loading" aria-hidden="true">…</span>}
            <img src={stamp.src} alt="Tanda tangan / stempel" className="sign-overlay" draggable={false}
              style={{ left: `${pos.xPct}%`, top: `${pos.yPct}%`, width: `${pos.widthPct}%`, opacity: pos.opacity }}
              onPointerDown={onOverlayDown} onPointerMove={onOverlayMove} onPointerUp={onOverlayUp} onPointerCancel={onOverlayUp} />
          </div>
          <div className="tool-form">
            <div className="tool-form-field">
              <label className="tool-form-label" htmlFor="sign-size">Ukuran: {pos.widthPct}% lebar halaman</label>
              <input id="sign-size" type="range" min={5} max={60} step={1} value={pos.widthPct} onChange={(e) => setPos((p) => ({ ...p, widthPct: Number(e.target.value) }))} />
            </div>
            <div className="tool-form-field">
              <label className="tool-form-label" htmlFor="sign-opacity">Opasitas: {Math.round(pos.opacity * 100)}%</label>
              <input id="sign-opacity" type="range" min={20} max={100} step={1} value={Math.round(pos.opacity * 100)} onChange={(e) => setPos((p) => ({ ...p, opacity: Number(e.target.value) / 100 }))} />
            </div>
          </div>
          <button className="primary" onClick={apply} disabled={busy || rendering}>
            {busy ? 'Memproses…' : allPages ? `Tempel ke semua ${pageCount} halaman →` : `Tempel ke halaman ${pageIndex + 1} →`}
          </button>
        </>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PageViewer } from './PageViewer';
import { canvasFont, FONT_OPTIONS, getFontDef, type FontDef, type WatermarkPosition, type WatermarkType } from '../engines/pdf-native';

GlobalWorkerOptions.workerSrc = workerUrl;

type Position = 'bottom-center' | 'bottom-left' | 'bottom-right' | 'top-center' | 'top-left' | 'top-right';
type Format = 'number' | 'page-of' | 'roman';

interface AnnotatePanelProps {
  bytes: ArrayBuffer;
  mode: 'page-numbers' | 'watermark';
  onProcess: (opts: Record<string, unknown>) => void;
  busy: boolean;
}

const PREVIEW_SCALE = 1.0;

function toRoman(num: number): string {
  const map: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let result = '';
  for (const [val, sym] of map) { while (num >= val) { result += sym; num -= val; } }
  return result;
}

export function AnnotatePanel({ bytes, mode, onProcess, busy }: AnnotatePanelProps) {
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<PDFDocumentProxy | undefined>(undefined);
  const pageRef = useRef<PDFPageProxy | undefined>(undefined);
  const taskRef = useRef<RenderTask | undefined>(undefined);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<number | null>(null);

  // Page number options
  const [position, setPosition] = useState<Position>('bottom-center');
  const [format, setFormat] = useState<Format>('number');
  const [startFrom, setStartFrom] = useState(1);
  const [pnFontSize, setPnFontSize] = useState(12);
  const [pnColor, setPnColor] = useState('#333333');
  const [pnFont, setPnFont] = useState('helvetica');

  // Watermark options
  const [wmType, setWmType] = useState<WatermarkType>('center');
  const [wmText, setWmText] = useState('RAHASIA');
  const [wmFontSize, setWmFontSize] = useState(50);
  const [wmOpacity, setWmOpacity] = useState(25);
  const [wmRotation, setWmRotation] = useState(45);
  const [wmColor, setWmColor] = useState('#808080');
  const [wmFont, setWmFont] = useState('helvetica-bold');
  const [wmPosition, setWmPosition] = useState<WatermarkPosition>('center');
  const [wmImage, setWmImage] = useState<{ bytes: ArrayBuffer; type: 'png' | 'jpg'; element: HTMLImageElement } | null>(null);
  const [wmImageScale, setWmImageScale] = useState(30);
  const [wmLetterSpacing, setWmLetterSpacing] = useState(0);
  const [wmLineHeight, setWmLineHeight] = useState(1.2);
  const [wmOffsetX, setWmOffsetX] = useState(0);
  const [wmOffsetY, setWmOffsetY] = useState(0);
  const [wmTileGap, setWmTileGap] = useState(2.5);

  // Font TTF/OTF yang diunggah user — hanya hidup selama sesi (state komponen)
  const [customFonts, setCustomFonts] = useState<{ id: string; label: string; bytes: ArrayBuffer; family: string }[]>([]);
  const [fontError, setFontError] = useState<string>();
  const fontInputRef = useRef<HTMLInputElement>(null);

  // Load document + render first page to base canvas
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise.then(async (doc) => {
      if (cancelled) { void doc.destroy(); return; }
      docRef.current = doc;
      setTotalPages(doc.numPages);
      const page = await doc.getPage(1);
      if (cancelled) { page.cleanup(); return; }
      pageRef.current = page;
      const viewport = page.getViewport({ scale: PREVIEW_SCALE });
      const canvas = baseCanvasRef.current;
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
      if (!cancelled) setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      taskRef.current?.cancel();
      docRef.current?.destroy();
    };
  }, [bytes]);

  // FontDef aktif untuk watermark — bisa font bawaan atau hasil unggahan user
  const activeWmFontDef = useMemo<FontDef>(() => {
    const custom = customFonts.find((f) => f.id === wmFont);
    if (custom) {
      return {
        id: custom.id,
        label: custom.label,
        family: `"${custom.family}"`,
        cssFamily: `"${custom.family}", Helvetica, Arial, sans-serif`,
        cssWeight: 'normal',
        cssStyle: 'normal',
      };
    }
    return getFontDef(wmFont);
  }, [customFonts, wmFont]);

  // Overlay drawing function — works at any scale
  const drawOverlay = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, scale: number) => {
    ctx.clearRect(0, 0, w, h);

    if (mode === 'page-numbers') {
      const fontSize = pnFontSize * scale;
      const margin = 28 * scale;
      const pageNum = startFrom;
      const total = totalPages + startFrom - 1;
      let label: string;
      if (format === 'page-of') label = `${pageNum} / ${total}`;
      else if (format === 'roman') label = toRoman(pageNum);
      else label = String(pageNum);
      ctx.font = canvasFont(getFontDef(pnFont), fontSize);
      ctx.fillStyle = pnColor;
      const tw = ctx.measureText(label).width;
      let x: number, y: number;
      const isBottom = position.startsWith('bottom');
      if (isBottom) y = h - margin;
      else y = margin + fontSize;
      if (position.endsWith('center')) x = (w - tw) / 2;
      else if (position.endsWith('left')) x = margin;
      else x = w - tw - margin;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(label, x, y);
      return;
    }

    // Watermark modes
    if (wmType === 'image' && wmImage) {
      const imgW = w * (wmImageScale / 100);
      const imgH = (wmImage.element.height / wmImage.element.width) * imgW;
      ctx.globalAlpha = wmOpacity / 100;
      ctx.drawImage(wmImage.element, (w - imgW) / 2, (h - imgH) / 2, imgW, imgH);
      ctx.globalAlpha = 1;
      return;
    }

    // Text watermark — multi-baris + letter spacing + offset
    const lines = wmText.split('\n');
    if (!lines.some((l) => l.trim())) return;
    const fontSize = wmFontSize * scale;
    const spacing = wmLetterSpacing * scale;
    const lineH = wmLineHeight * fontSize;
    const offX = wmOffsetX * scale;
    const offY = wmOffsetY * scale;
    ctx.font = canvasFont(activeWmFontDef, fontSize);
    ctx.fillStyle = wmColor;
    ctx.globalAlpha = wmOpacity / 100;

    // Lebar satu baris termasuk letter spacing
    const lineWidth = (line: string) => {
      if (!line) return 0;
      const chars = [...line];
      const base = chars.reduce((acc, ch) => acc + ctx.measureText(ch).width, 0);
      return spacing !== 0 ? base + spacing * (chars.length - 1) : base;
    };
    const widest = Math.max(...lines.map(lineWidth));
    const blockH = (lines.length - 1) * lineH;

    // Gambar satu baris terpusat di (cx, y) pada koordinat konteks saat ini
    const drawLine = (line: string, cx: number, y: number) => {
      if (!line) return;
      if (spacing === 0) {
        const prev = ctx.textAlign;
        ctx.textAlign = 'center';
        ctx.fillText(line, cx, y);
        ctx.textAlign = prev;
        return;
      }
      // spacing ≠ 0 (termasuk negatif): gambar per karakter agar presisi
      const chars = [...line];
      const widths = chars.map((ch) => ctx.measureText(ch).width);
      const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
      let x = cx - total / 2;
      const prev = ctx.textAlign;
      ctx.textAlign = 'left';
      chars.forEach((ch, i) => { ctx.fillText(ch, x, y); x += widths[i] + spacing; });
      ctx.textAlign = prev;
    };

    // Gambar blok multi-baris terpusat di (cx, cy); rotasi opsional
    const drawBlock = (cx: number, cy: number, rotate: boolean) => {
      ctx.save();
      ctx.translate(cx, cy);
      if (rotate) ctx.rotate((-wmRotation * Math.PI) / 180);
      ctx.textBaseline = 'middle';
      lines.forEach((line, li) => drawLine(line, 0, (li - (lines.length - 1) / 2) * lineH));
      ctx.restore();
    };

    if (wmType === 'tiled') {
      // Jarak antar ubin sebagai pengali ukuran font (diskalakan bersama preview)
      const gap = wmTileGap * fontSize;
      const stepX = widest + gap;
      const stepY = blockH + fontSize + gap;
      for (let y = stepY / 2; y < h + stepY; y += stepY) {
        for (let x = -stepX; x < w + stepX; x += stepX) {
          const rowOffset = (Math.floor(y / stepY) % 2) * (stepX / 2);
          drawBlock(x + rowOffset + widest / 2 + offX, y + offY, true);
        }
      }
    } else if (wmType === 'positioned') {
      const margin = 40 * scale;
      let bx: number, by: number;
      switch (wmPosition) {
        case 'top-left': bx = margin + widest / 2; by = margin + blockH / 2; break;
        case 'top-right': bx = w - margin - widest / 2; by = margin + blockH / 2; break;
        case 'bottom-left': bx = margin + widest / 2; by = h - margin - blockH / 2; break;
        case 'bottom-right': bx = w - margin - widest / 2; by = h - margin - blockH / 2; break;
        default: bx = w / 2; by = h / 2;
      }
      drawBlock(bx + offX, by + offY, wmPosition === 'center');
    } else {
      drawBlock(w / 2 + offX, h / 2 + offY, true);
    }
    ctx.globalAlpha = 1;
  }, [mode, totalPages, position, format, startFrom, pnFontSize, pnColor, pnFont, wmType, wmText, wmFontSize, wmOpacity, wmRotation, wmColor, wmFont, wmPosition, wmImage, wmImageScale, wmLetterSpacing, wmLineHeight, wmOffsetX, wmOffsetY, wmTileGap, activeWmFontDef]);

  // Preload custom font untuk canvas (document.fonts.load), lalu re-render overlay
  const [fontReady, setFontReady] = useState(0);
  useEffect(() => {
    const def = mode === 'page-numbers' ? getFontDef(pnFont) : activeWmFontDef;
    if (def.standard || !('fonts' in document)) return;
    let cancelled = false;
    // Gunakan family utama saja (tanpa fallback chain) agar parse selalu valid
    document.fonts.load(`${def.cssStyle} ${def.cssWeight} 48px ${def.family}`).then(() => {
      if (!cancelled) setFontReady((n) => n + 1);
    }).catch(() => { /* fallback ke system font */ });
    return () => { cancelled = true; };
  }, [mode, pnFont, activeWmFontDef]);

  // Draw overlay on preview canvas whenever options change
  // fontReady di deps agar overlay digambar ulang setelah custom font selesai dimuat
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas || loading || !pageSize.width) return;
    canvas.width = pageSize.width;
    canvas.height = pageSize.height;
    const ctx = canvas.getContext('2d');
    if (ctx) drawOverlay(ctx, pageSize.width, pageSize.height, PREVIEW_SCALE);
  }, [drawOverlay, loading, pageSize, fontReady]);

  // Overlay for PageViewer (scale = canvasWidth / pageSize.width)
  const viewerOverlay = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const scale = pageSize.width ? w / pageSize.width : 1;
    drawOverlay(ctx, w, h, scale);
  }, [drawOverlay, pageSize.width]);

  // Handle image upload
  const handleImageUpload = async (file: File) => {
    const buf = await file.arrayBuffer();
    const type = file.type.includes('jpeg') || file.type.includes('jpg') ? 'jpg' : 'png';
    const url = URL.createObjectURL(new Blob([buf], { type: file.type }));
    const img = new Image();
    img.onload = () => setWmImage({ bytes: buf, type, element: img });
    img.src = url;
  };

  // Handle unggah font TTF/OTF: validasi magic bytes → daftarkan FontFace → simpan di sesi
  const handleFontUpload = async (file: File) => {
    setFontError(undefined);
    if (file.size > 10 * 1024 * 1024) { setFontError('Ukuran font maksimal 10 MB.'); return; }
    const buf = await file.arrayBuffer();
    if (buf.byteLength < 12) { setFontError('File font tidak valid.'); return; }
    const magic = new DataView(buf).getUint32(0);
    const isOtf = magic === 0x4f54544f;        // 'OTTO'
    const isTtf = magic === 0x00010000          // sfnt 1.0 (TTF)
      || magic === 0x74727565                   // 'true'
      || magic === 0x74746366;                  // 'ttcf' (collection)
    if (!isOtf && !isTtf) { setFontError('Format tidak didukung. Gunakan file TTF atau OTF.'); return; }
    const id = `custom-${crypto.randomUUID()}`;
    const family = `PrivaDF-${id}`;
    try {
      const face = new FontFace(family, buf);
      await face.load();
      document.fonts.add(face);
    } catch {
      setFontError('Font gagal dimuat browser. File mungkin rusak.');
      return;
    }
    setCustomFonts((prev) => [...prev, { id, label: file.name.replace(/\.(ttf?|otf)$/i, '') || 'Font kustom', bytes: buf, family }]);
    setWmFont(id);
  };

  const submit = () => {
    if (mode === 'page-numbers') {
      onProcess({ position, format, startFrom, fontSize: pnFontSize, margin: 28, color: pnColor, font: pnFont });
    } else {
      const custom = customFonts.find((f) => f.id === wmFont);
      const opts: Record<string, unknown> = {
        type: wmType,
        text: wmText,
        fontSize: wmFontSize,
        opacity: wmOpacity / 100,
        rotation: wmRotation,
        color: wmColor,
        font: wmFont,
        letterSpacing: wmLetterSpacing,
        lineHeight: wmLineHeight,
        offsetX: wmOffsetX,
        offsetY: wmOffsetY,
      };
      if (wmType === 'positioned') opts.position = wmPosition;
      if (wmType === 'tiled') opts.tileGap = wmTileGap * wmFontSize; // engine pakai pt absolut
      if (custom) opts.customFontBytes = custom.bytes;
      if (wmType === 'image' && wmImage) {
        opts.imageBytes = wmImage.bytes;
        opts.imageType = wmImage.type;
        opts.imageScale = wmImageScale / 100;
      }
      onProcess(opts);
    }
  };

  return (
    <div className="split-panel">
      <div className="annotate-layout">
        <div className="annotate-preview-wrap">
          <div className="annotate-canvas-stack">
            <canvas ref={baseCanvasRef} className="annotate-canvas-base" />
            <canvas ref={overlayCanvasRef} className="annotate-canvas-overlay" />
            {!loading && <button type="button" className="page-thumb-zoom annotate-zoom-btn" onClick={() => setViewing(0)} aria-label="Lihat halaman full">⤢</button>}
            {loading && <div className="annotate-loading">Memuat halaman…</div>}
          </div>
          <p className="annotate-caption">Pratinjau langsung — halaman 1 dari {totalPages}</p>
        </div>

        <div className="tool-form annotate-form">
          {mode === 'page-numbers' ? (
            <>
              <div className="tool-form-field">
                <label className="tool-form-label" htmlFor="pn-pos">Posisi</label>
                <select id="pn-pos" className="tool-form-input" value={position} onChange={(e) => setPosition(e.target.value as Position)}>
                  <option value="bottom-center">Bawah Tengah</option>
                  <option value="bottom-left">Bawah Kiri</option>
                  <option value="bottom-right">Bawah Kanan</option>
                  <option value="top-center">Atas Tengah</option>
                  <option value="top-left">Atas Kiri</option>
                  <option value="top-right">Atas Kanan</option>
                </select>
              </div>
              <div className="tool-form-field">
                <label className="tool-form-label" htmlFor="pn-fmt">Format</label>
                <select id="pn-fmt" className="tool-form-input" value={format} onChange={(e) => setFormat(e.target.value as Format)}>
                  <option value="number">1, 2, 3</option>
                  <option value="page-of">1 / {totalPages}</option>
                  <option value="roman">i, ii, iii</option>
                </select>
              </div>
              <div className="tool-form-field">
                <label className="tool-form-label" htmlFor="pn-start">Mulai dari</label>
                <input id="pn-start" type="number" className="tool-form-input" value={startFrom} min={1} onChange={(e) => setStartFrom(Number(e.target.value))} />
              </div>
              <div className="tool-form-field">
                <div className="tool-form-range-row">
                  <label className="tool-form-label" htmlFor="pn-size">Ukuran font</label>
                  <span className="tool-form-range-value">{pnFontSize}</span>
                </div>
                <input id="pn-size" type="range" min={6} max={36} value={pnFontSize} onChange={(e) => setPnFontSize(Number(e.target.value))} />
              </div>
              <div className="tool-form-field">
                <label className="tool-form-label" htmlFor="pn-color">Warna</label>
                <input id="pn-color" type="color" className="annotate-color-input" value={pnColor} onChange={(e) => setPnColor(e.target.value)} />
              </div>
              <div className="tool-form-field">
                <label className="tool-form-label" htmlFor="pn-font">Font</label>
                <select id="pn-font" className="tool-form-input" value={pnFont} onChange={(e) => setPnFont(e.target.value)}>
                  {FONT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
            </>
          ) : (
            <>
              <div className="tool-form-field">
                <label className="tool-form-label">Jenis tanda air</label>
                <div className="wm-type-tabs">
                  <button type="button" className={`wm-type-tab ${wmType === 'center' ? 'is-active' : ''}`} onClick={() => setWmType('center')}>Tengah</button>
                  <button type="button" className={`wm-type-tab ${wmType === 'tiled' ? 'is-active' : ''}`} onClick={() => setWmType('tiled')}>Berubin</button>
                  <button type="button" className={`wm-type-tab ${wmType === 'positioned' ? 'is-active' : ''}`} onClick={() => setWmType('positioned')}>Posisi</button>
                  <button type="button" className={`wm-type-tab ${wmType === 'image' ? 'is-active' : ''}`} onClick={() => setWmType('image')}>Gambar</button>
                </div>
              </div>

              {wmType === 'image' ? (
                <>
                  <div className="tool-form-field">
                    <label className="tool-form-label" htmlFor="wm-img">Unggah gambar</label>
                    <input id="wm-img" type="file" accept="image/png,image/jpeg" className="tool-form-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImageUpload(f); }} />
                  </div>
                  {wmImage && (
                    <div className="tool-form-field">
                      <div className="tool-form-range-row">
                        <label className="tool-form-label" htmlFor="wm-img-scale">Ukuran gambar</label>
                        <span className="tool-form-range-value">{wmImageScale}%</span>
                      </div>
                      <input id="wm-img-scale" type="range" min={10} max={80} value={wmImageScale} onChange={(e) => setWmImageScale(Number(e.target.value))} />
                    </div>
                  )}
                  <div className="tool-form-field">
                    <div className="tool-form-range-row">
                      <label className="tool-form-label" htmlFor="wm-img-op">Opasitas</label>
                      <span className="tool-form-range-value">{wmOpacity}%</span>
                    </div>
                    <input id="wm-img-op" type="range" min={5} max={80} value={wmOpacity} onChange={(e) => setWmOpacity(Number(e.target.value))} />
                  </div>
                </>
              ) : (
                <>
                  <div className="tool-form-field">
                    <label className="tool-form-label" htmlFor="wm-text">Teks tanda air</label>
                    <textarea id="wm-text" className="tool-form-input wm-textarea" rows={2} value={wmText} placeholder="Contoh: RAHASIA — tekan Enter untuk baris baru" onChange={(e) => setWmText(e.target.value)} />
                    <small className="wm-text-meta">{wmText.split('\n').length} baris — tekan Enter di kolom teks untuk menambah baris</small>
                  </div>

                  {wmType === 'positioned' && (
                    <div className="tool-form-field">
                      <label className="tool-form-label" htmlFor="wm-pos">Posisi</label>
                      <select id="wm-pos" className="tool-form-input" value={wmPosition} onChange={(e) => setWmPosition(e.target.value as WatermarkPosition)}>
                        <option value="center">Tengah</option>
                        <option value="top-left">Kiri Atas</option>
                        <option value="top-right">Kanan Atas</option>
                        <option value="bottom-left">Kiri Bawah</option>
                        <option value="bottom-right">Kanan Bawah</option>
                      </select>
                    </div>
                  )}

                  <div className="tool-form-field">
                    <div className="tool-form-range-row">
                      <label className="tool-form-label" htmlFor="wm-size">Ukuran font</label>
                      <span className="tool-form-range-value">{wmFontSize}</span>
                    </div>
                    <input id="wm-size" type="range" min={12} max={120} value={wmFontSize} onChange={(e) => setWmFontSize(Number(e.target.value))} />
                  </div>
                  <div className="tool-form-field">
                    <div className="tool-form-range-row">
                      <label className="tool-form-label" htmlFor="wm-op">Opasitas</label>
                      <span className="tool-form-range-value">{wmOpacity}%</span>
                    </div>
                    <input id="wm-op" type="range" min={5} max={80} value={wmOpacity} onChange={(e) => setWmOpacity(Number(e.target.value))} />
                  </div>
                  {wmType !== 'positioned' && (
                    <div className="tool-form-field">
                      <div className="tool-form-range-row">
                        <label className="tool-form-label" htmlFor="wm-rot">Rotasi</label>
                        <span className="tool-form-range-value">{wmRotation}°</span>
                      </div>
                      <input id="wm-rot" type="range" min={0} max={90} value={wmRotation} onChange={(e) => setWmRotation(Number(e.target.value))} />
                    </div>
                  )}
                  {wmType === 'tiled' && (
                    <div className="tool-form-field">
                      <div className="tool-form-range-row">
                        <label className="tool-form-label" htmlFor="wm-tilegap">Jarak antar ubin</label>
                        <span className="tool-form-range-value">{wmTileGap.toFixed(1)}×</span>
                      </div>
                      <input id="wm-tilegap" type="range" min={0.5} max={6} step={0.1} value={wmTileGap} onChange={(e) => setWmTileGap(Number(e.target.value))} />
                      <small className="wm-field-hint">Pengali ukuran font — kecil = rapat, besar = renggang</small>
                    </div>
                  )}
                  <div className="tool-form-field">
                    <div className="tool-form-range-row">
                      <label className="tool-form-label" htmlFor="wm-spacing">Spasi huruf</label>
                      <span className="tool-form-range-value">{wmLetterSpacing > 0 ? `+${wmLetterSpacing}` : wmLetterSpacing}</span>
                    </div>
                    <input id="wm-spacing" type="range" min={-5} max={20} step={0.5} value={wmLetterSpacing} onChange={(e) => setWmLetterSpacing(Number(e.target.value))} />
                  </div>
                  <div className={`tool-form-field ${wmText.split('\n').length < 2 ? 'is-disabled' : ''}`}>
                    <div className="tool-form-range-row">
                      <label className="tool-form-label" htmlFor="wm-lineh">Tinggi baris</label>
                      <span className="tool-form-range-value">{wmLineHeight.toFixed(2)}×</span>
                    </div>
                    <input
                      id="wm-lineh"
                      type="range"
                      min={0.8}
                      max={2.5}
                      step={0.05}
                      value={wmLineHeight}
                      disabled={wmText.split('\n').length < 2}
                      onChange={(e) => setWmLineHeight(Number(e.target.value))}
                    />
                    {wmText.split('\n').length < 2 && (
                      <small className="wm-field-hint">Berlaku untuk teks multi-baris — tambahkan baris kedua dulu</small>
                    )}
                  </div>
                  <div className="tool-form-field">
                    <div className="tool-form-range-row">
                      <label className="tool-form-label" htmlFor="wm-offx">Geser horizontal</label>
                      <span className="tool-form-range-value">{wmOffsetX > 0 ? `+${wmOffsetX}` : wmOffsetX}</span>
                    </div>
                    <input id="wm-offx" type="range" min={-300} max={300} step={5} value={wmOffsetX} onChange={(e) => setWmOffsetX(Number(e.target.value))} />
                  </div>
                  <div className="tool-form-field">
                    <div className="tool-form-range-row">
                      <label className="tool-form-label" htmlFor="wm-offy">Geser vertikal</label>
                      <span className="tool-form-range-value">{wmOffsetY > 0 ? `+${wmOffsetY}` : wmOffsetY}</span>
                    </div>
                    <input id="wm-offy" type="range" min={-300} max={300} step={5} value={wmOffsetY} onChange={(e) => setWmOffsetY(Number(e.target.value))} />
                  </div>
                  <div className="tool-form-field">
                    <label className="tool-form-label" htmlFor="wm-color">Warna</label>
                    <input id="wm-color" type="color" className="annotate-color-input" value={wmColor} onChange={(e) => setWmColor(e.target.value)} />
                  </div>
                  <div className="tool-form-field">
                    <label className="tool-form-label" htmlFor="wm-font">Font</label>
                    <select id="wm-font" className="tool-form-input" value={wmFont} onChange={(e) => setWmFont(e.target.value)}>
                      <optgroup label="Font bawaan">
                        {FONT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </optgroup>
                      {customFonts.length > 0 && (
                        <optgroup label="Font diunggah">
                          {customFonts.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                        </optgroup>
                      )}
                    </select>
                    <button type="button" className="ghost-btn wm-upload-btn" onClick={() => fontInputRef.current?.click()}>
                      ⬆ Unggah font (TTF/OTF)
                    </button>
                    <input ref={fontInputRef} hidden type="file" accept=".ttf,.otf" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFontUpload(f); e.target.value = ''; }} />
                    {fontError && <p className="wm-font-error" role="alert">{fontError}</p>}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
      <button className="primary" onClick={submit} disabled={busy || (mode === 'watermark' && wmType === 'image' && !wmImage)}>
        {busy ? 'Memproses…' : mode === 'page-numbers' ? 'Terapkan ke semua halaman →' : 'Tambah tanda air →'}
      </button>
      {viewing !== null && (
        <PageViewer bytes={bytes} pageNumber={viewing} totalPages={totalPages} onClose={() => setViewing(null)} onPageChange={setViewing} overlayDraw={viewerOverlay} />
      )}
    </div>
  );
}

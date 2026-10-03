import { useEffect, useRef, useState } from 'react';
import { applyKey, cornerColor } from '../lib/remove-bg';
import { removeBackgroundAI, type BgModelQuality } from '../lib/remove-bg-ai';
import { removeBackgroundImgly } from '../lib/remove-bg-imgly';

interface RemoveBgPanelProps {
  bytes: ArrayBuffer;
  onProcess: (blob: Blob) => void;
  busy: boolean;
}

const rgbHex = (c: [number, number, number]) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const hexRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

type Mode = 'ai' | 'solid';

export function RemoveBgPanel({ bytes, onProcess, busy }: RemoveBgPanelProps) {
  const [mode, setMode] = useState<Mode>('ai');
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();

  // ---- Mode warna solid (ringan, instan) ----
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const [refColor, setRefColor] = useState('#ffffff');
  const [tolerance, setTolerance] = useState(45);
  const [softness, setSoftness] = useState(25);
  const [keyMode, setKeyMode] = useState<'edges' | 'global'>('edges');
  const [solidReady, setSolidReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    setReady(false);
    setSolidReady(false);
    setResultUrl(null);
    setResultBlob(null);
    createImageBitmap(new Blob([bytes]))
      .then((bitmap) => {
        if (cancelled) {
          bitmap.close();
          return;
        }
        const off = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = off.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const imageData = ctx.getImageData(0, 0, off.width, off.height);
        imageDataRef.current = imageData;
        setRefColor(rgbHex(cornerColor(imageData.data, off.width, off.height)));
        setSolidReady(true);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setError('Gambar tidak valid atau rusak.');
      });
    return () => {
      cancelled = true;
    };
  }, [bytes]);

  useEffect(() => {
    if (mode !== 'solid' || !solidReady) return;
    const timer = setTimeout(() => {
      const source = imageDataRef.current;
      const canvas = canvasRef.current;
      if (!source || !canvas) return;
      const data = new Uint8ClampedArray(source.data);
      applyKey(data, source.width, source.height, { ref: hexRgb(refColor), tolerance, softness, mode: keyMode });
      canvas.width = source.width;
      canvas.height = source.height;
      canvas.getContext('2d')?.putImageData(new ImageData(data, source.width, source.height), 0, 0);
    }, 120);
    return () => clearTimeout(timer);
  }, [mode, solidReady, refColor, tolerance, softness, keyMode]);

  const downloadSolid = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) {
        setError('Gagal mengenalikan PNG.');
        return;
      }
      onProcess(blob);
    }, 'image/png');
  };

  // ---- Mode AI (U²-Net/ISNet bawaan + imgly) ----
  const [quality, setQuality] = useState<BgModelQuality>('imgly-fp16');
  const [elapsed, setElapsed] = useState(0);
  const tickerRef = useRef<number | null>(null);

  const startTicker = () => {
    const started = Date.now();
    setElapsed(0);
    if (tickerRef.current) clearInterval(tickerRef.current);
    tickerRef.current = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
  };
  const stopTicker = () => {
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
  };
  useEffect(() => () => stopTicker(), []);

  const runAi = async () => {
    setAiBusy(true);
    setError(undefined);
    setResultUrl(null);
    setResultBlob(null);
    startTicker();
    try {
      const onStatus = (message: string) => {
        stopTicker();
        setStatusText(message);
      };
      const blob =
        quality === 'imgly-fp16' || quality === 'imgly-quint8'
          ? await removeBackgroundImgly(bytes, quality === 'imgly-quint8' ? 'isnet_quint8' : 'isnet_fp16', onStatus)
          : await removeBackgroundAI(bytes, onStatus);
      setResultBlob(blob);
      setResultUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Konversi gagal.');
    }
    stopTicker();
    setStatusText('');
    setAiBusy(false);
  };

  const downloadAi = () => {
    if (!resultBlob) return;
    onProcess(resultBlob);
  };

  if (error) return <div className="preview-error" role="alert">{error}</div>;

  return (
    <div className="split-panel">
      <div className="preview-heading">
        <span>Hapus latar</span>
        <small>{mode === 'ai' ? 'Model AI memisahkan objek dari latar apa pun' : 'Untuk latar warna solid: foto produk, logo, tangkapan layar'}</small>
      </div>
      <div className="split-tabs" role="tablist" aria-label="Metode hapus latar">
        <button role="tab" aria-selected={mode === 'ai'} className={`split-tab ${mode === 'ai' ? 'is-active' : ''}`} onClick={() => setMode('ai')}>AI (hasil maksimal)</button>
        <button role="tab" aria-selected={mode === 'solid'} className={`split-tab ${mode === 'solid' ? 'is-active' : ''}`} onClick={() => setMode('solid')}>Warna solid</button>
      </div>

      {mode === 'ai' ? (
        <>
          <p className="split-hint">
            Empat varian model, semuanya berjalan lokal di browser. Unduhan hanya sekali per browser.
          </p>
          <div className="tool-form">
            <div className="tool-form-field">
              <label className="tool-form-label" htmlFor="rb-quality">Kualitas model</label>
              <select id="rb-quality" className="tool-form-input" value={quality} disabled={aiBusy || busy} onChange={(e) => setQuality(e.target.value as BgModelQuality)}>
                <option value="imgly-fp16">Seimbang — imgly ISNet fp16, ±22 MB</option>
                <option value="imgly-quint8">Ringan — imgly ISNet quint8, ±11 MB</option>
                <option value="cepat">Cepat — u2netp, ±4 MB</option>
              </select>
            </div>
          </div>
          {resultUrl ? (
            <>
              <div className="removebg-stage">
                <img src={resultUrl} alt="Hasil hapus latar" className="removebg-canvas" />
              </div>
              <button className="primary" onClick={downloadAi} disabled={busy || aiBusy}>
                Unduh PNG transparan →
              </button>
              <button className="ghost-btn" onClick={() => { setResultUrl(null); setResultBlob(null); }} disabled={aiBusy}>Proses ulang</button>
            </>
          ) : (
            <>
              <button className="primary" onClick={runAi} disabled={aiBusy || busy}>
                {aiBusy ? 'Memproses…' : 'Hapus latar dengan AI →'}
              </button>
              {aiBusy && (
                <div className="status" role="status">{statusText || 'Memproses…'}{elapsed ? ` (${elapsed}s)` : ''}</div>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div className="removebg-stage">
            <canvas ref={canvasRef} className="removebg-canvas" style={{ visibility: solidReady ? 'visible' : 'hidden' }} />
          </div>
          <div className="tool-form">
            <div className="tool-form-field">
              <label className="tool-form-label" htmlFor="rb-color">Warna latar</label>
              <div className="removebg-color-row">
                <input id="rb-color" type="color" value={refColor} disabled={busy} onChange={(e) => setRefColor(e.target.value)} />
                <button type="button" className="ghost-btn" disabled={busy} onClick={() => {
                  const d = imageDataRef.current;
                  if (d) setRefColor(rgbHex(cornerColor(d.data, d.width, d.height)));
                }}>Deteksi ulang dari sudut</button>
              </div>
            </div>
            <div className="tool-form-field">
              <label className="tool-form-label" htmlFor="rb-tol">Toleransi: {tolerance}</label>
              <input id="rb-tol" type="range" min={0} max={120} step={1} value={tolerance} disabled={busy} onChange={(e) => setTolerance(Number(e.target.value))} />
            </div>
            <div className="tool-form-field">
              <label className="tool-form-label" htmlFor="rb-soft">Kelembutan tepi: {softness}</label>
              <input id="rb-soft" type="range" min={0} max={80} step={1} value={softness} disabled={busy} onChange={(e) => setSoftness(Number(e.target.value))} />
            </div>
            <div className="tool-form-field">
              <label className="tool-form-label" htmlFor="rb-mode">Mode</label>
              <select id="rb-mode" className="tool-form-input" value={keyMode} disabled={busy} onChange={(e) => setKeyMode(e.target.value as 'edges' | 'global')}>
                <option value="edges">Dari tepi (objek sewarna di tengah tetap aman)</option>
                <option value="global">Semua piksel serupa</option>
              </select>
            </div>
          </div>
          <button className="primary" onClick={downloadSolid} disabled={busy || !solidReady}>
            {busy ? 'Memproses…' : 'Unduh PNG transparan →'}
          </button>
        </>
      )}
    </div>
  );
}

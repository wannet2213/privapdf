import { useState } from 'react';
import { convertImage, withFormatExt, type ImageFormat } from '../lib/image-toolkit';
import type { SessionFile } from '../lib/file-session';
import { tr } from '../lib/i18n';

const FORMATS: { value: ImageFormat; label: string }[] = [
  { value: 'image/jpeg', label: 'JPEG' },
  { value: 'image/png', label: 'PNG' },
  { value: 'image/webp', label: 'WebP' },
];

export interface ImageOutput {
  name: string;
  blob: Blob;
}

interface ImageToolkitPanelProps {
  files: SessionFile[];
  onProcess: (items: ImageOutput[]) => void;
}

interface FileResult {
  name: string;
  originalBytes: number;
  newBytes: number;
  width: number;
  height: number;
}

const fmtKB = (bytes: number) => (bytes / 1024).toFixed(bytes / 1024 >= 100 ? 0 : 1) + ' KB';

export function ImageToolkitPanel({ files, onProcess }: ImageToolkitPanelProps) {
  const [format, setFormat] = useState<ImageFormat>('image/jpeg');
  const [quality, setQuality] = useState(80);
  const [maxWidth, setMaxWidth] = useState(0);
  const [converting, setConverting] = useState(false);
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState<FileResult[] | null>(null);
  const [error, setError] = useState<string>();

  const convertAll = async () => {
    setConverting(true);
    setError(undefined);
    setResults(null);
    const outputs: ImageOutput[] = [];
    const summary: FileResult[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setProgress(tr(`Mengonversi ${i + 1}/${files.length}: ${file.name}`, `Converting ${i + 1}/${files.length}: ${file.name}`));
        const result = await convertImage(file.bytes, { format, quality: quality / 100, maxWidth });
        // Nama mengikuti format aktual — bila browser tak mendukung enkoding
        // WebP dan jatuh ke PNG, file otomatis bernama .png.
        outputs.push({ name: withFormatExt(file.name, result.actualFormat), blob: result.blob });
        summary.push({ name: file.name, originalBytes: file.bytes.byteLength, newBytes: result.blob.size, width: result.width, height: result.height });
      }
      setResults(summary);
      onProcess(outputs);
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('Konversi gambar gagal.', 'Image conversion failed.'));
    }
    setConverting(false);
    setProgress('');
  };

  const totalIn = results?.reduce((n, r) => n + r.originalBytes, 0) ?? 0;
  const totalOut = results?.reduce((n, r) => n + r.newBytes, 0) ?? 0;
  const saved = totalIn > 0 ? Math.round((1 - totalOut / totalIn) * 100) : 0;

  return (
    <div className="split-panel">
      <div className="preview-heading">
        <span>{tr(`${files.length} gambar`, `${files.length} image(s)`)}</span>
        <small>{tr('Konversi + kompresi + resize massal. Re-encode menghapus EXIF (GPS, info kamera).', 'Batch convert + compress + resize. Re-encoding strips EXIF (GPS, camera info).')}</small>
      </div>
      <div className="tool-form">
        <div className="tool-form-field">
          <label className="tool-form-label" htmlFor="img-format">{tr('Format keluaran', 'Output format')}</label>
          <select id="img-format" className="tool-form-input" value={format} disabled={converting} onChange={(e) => setFormat(e.target.value as ImageFormat)}>
            {FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        <div className="tool-form-field">
          <label className="tool-form-label" htmlFor="img-quality">
            {tr('Kualitas', 'Quality')}: {quality}%{format === 'image/png' && tr(' (diabaikan — PNG lossless)', ' (ignored — PNG is lossless)')}
          </label>
          <input id="img-quality" type="range" min={10} max={100} step={1} value={quality} disabled={converting || format === 'image/png'} onChange={(e) => setQuality(Number(e.target.value))} />
        </div>
        <div className="tool-form-field">
          <label className="tool-form-label" htmlFor="img-maxw">{tr('Lebar maksimum (px, 0 = tetap)', 'Max width (px, 0 = unchanged)')}</label>
          <input id="img-maxw" type="number" min={0} step={50} className="tool-form-input" value={maxWidth} disabled={converting} onChange={(e) => setMaxWidth(Math.max(0, Number(e.target.value) || 0))} />
        </div>
      </div>
      {error && <div className="preview-error" role="alert">{error}</div>}
      <button className="primary" onClick={convertAll} disabled={converting}>
        {converting ? progress || tr('Memproses…', 'Processing…') : tr(`Konversi ${files.length} gambar →`, `Convert ${files.length} image(s) →`)}
      </button>
      {results && (
        <div className="image-results">
          {results.map((r) => (
            <div key={r.name} className="image-result-row">
              <span className="image-result-name">{r.name}</span>
              <span>{r.width}×{r.height}</span>
              <span>{fmtKB(r.originalBytes)} → {fmtKB(r.newBytes)}</span>
            </div>
          ))}
          <div className="image-result-total">
            Total: {fmtKB(totalIn)} → {fmtKB(totalOut)}{saved > 0 ? tr(` (hemat ${saved}%)`, ` (${saved}% saved)`) : saved < 0 ? tr(` (+${-saved}% lebih besar)`, ` (+${-saved}% larger)`) : ''}
          </div>
        </div>
      )}
    </div>
  );
}

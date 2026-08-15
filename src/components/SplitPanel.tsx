import { useMemo, useState } from 'react';
import type { SplitOptions, SplitMode } from '../engine/types';
import { PdfPreview } from '../lib/pdf-preview';
import { toggleSelection } from '../lib/reorder';
import { parseRanges, parseGroups, validateRanges, validateGroups, type Range } from '../lib/split-parse';

interface SplitPanelProps {
  bytes: ArrayBuffer;
  filename: string;
  pageCount: number;
  onProcess: (options: SplitOptions) => void;
  busy: boolean;
}

type PageCard = { page: number; label: string };

export function SplitPanel({ bytes, filename, pageCount, onProcess, busy }: SplitPanelProps) {
  const [mode, setMode] = useState<SplitMode>('each');
  const [selected, setSelected] = useState<number[]>(Array.from({ length: pageCount }, (_, i) => i));
  const [rangeText, setRangeText] = useState('1-1');
  const [groupText, setGroupText] = useState('1\n2');
  const [asZip, setAsZip] = useState(true);

  const pages: PageCard[] = useMemo(() => Array.from({ length: pageCount }, (_, i) => ({ page: i, label: `Halaman ${i + 1}` })), [pageCount]);

  const parsedRanges: Range[] = useMemo(() => parseRanges(rangeText), [rangeText]);
  const rangeError = useMemo(() => validateRanges(parsedRanges, pageCount), [parsedRanges, pageCount]);

  const parsedGroups: number[][] = useMemo(() => parseGroups(groupText), [groupText]);
  const groupError = useMemo(() => validateGroups(parsedGroups, pageCount), [parsedGroups, pageCount]);

  const canRun = mode === 'each' ? selected.length > 0 : mode === 'ranges' ? !rangeError : !groupError;
  const outputCount = mode === 'each' ? selected.length : mode === 'ranges' ? parsedRanges.length : parsedGroups.filter((g) => g.length).length;

  const run = () => {
    if (mode === 'each') {
      onProcess({ mode: 'each', indices: selected, filename, asZip });
    } else if (mode === 'ranges') {
      onProcess({ mode: 'ranges', ranges: parsedRanges, filename, asZip });
    } else {
      onProcess({ mode: 'groups', groups: parsedGroups.filter((g) => g.length), filename, asZip });
    }
  };

  return (
    <div className="split-panel">
      <div className="split-tabs" role="tablist" aria-label="Mode pemisahan PDF">
        <button role="tab" aria-selected={mode === 'each'} className={`split-tab ${mode === 'each' ? 'is-active' : ''}`} onClick={() => setMode('each')}>
          Per halaman
          <small>{pageCount} file</small>
        </button>
        <button role="tab" aria-selected={mode === 'ranges'} className={`split-tab ${mode === 'ranges' ? 'is-active' : ''}`} onClick={() => setMode('ranges')}>
          Rentang
          <small>1-5, 6-10</small>
        </button>
        <button role="tab" aria-selected={mode === 'groups'} className={`split-tab ${mode === 'groups' ? 'is-active' : ''}`} onClick={() => setMode('groups')}>
          Kelompok
          <small>1,3,5 | 2,6</small>
        </button>
      </div>

      <div className="split-content">
        {mode === 'each' && (
          <>
            <div className="preview-heading">
              <span>Pilih halaman</span>
              <small>{selected.length} dari {pageCount} dipilih</small>
            </div>
            <div className="split-bulk-actions">
              <button type="button" className="ghost-btn" onClick={() => setSelected(pages.map((p) => p.page))}>Pilih semua</button>
              <button type="button" className="ghost-btn" onClick={() => setSelected([])}>Kosongkan</button>
              <button type="button" className="ghost-btn" onClick={() => setSelected(selected.length === pageCount ? [] : pages.map((p) => p.page))}>
                {selected.length === pageCount ? 'Kosongkan semua' : 'Balik pilihan'}
              </button>
            </div>
            <PdfPreview bytes={bytes} pages={pages} selected={selected} onToggle={(page) => setSelected(toggleSelection(selected, page, pages.map((c) => c.page)))} onMove={() => {}} />
            <p className="split-hint">Setiap halaman yang dipilih akan menjadi file PDF terpisah ({selected.length} file output).</p>
          </>
        )}

        {mode === 'ranges' && (
          <>
            <label className="split-field">
              <span className="split-field-label">Rentang halaman</span>
              <textarea
                className="split-input"
                value={rangeText}
                onChange={(e) => setRangeText(e.target.value)}
                placeholder={'Contoh: 1-5, 6-10\nAtau halaman tunggal: 1, 5, 10'}
                rows={3}
                aria-describedby="range-hint"
              />
              <small id="range-hint" className="split-field-hint">Pisahkan dengan koma atau baris baru. Gunakan tanda hubung untuk rentang.</small>
            </label>
            {rangeError ? (
              <div className="split-error" role="alert">{rangeError}</div>
            ) : (
              <div className="split-preview-list">
                <div className="preview-heading"><span>Hasil pemisahan</span><small>{parsedRanges.length} file</small></div>
                {parsedRanges.map(([s, e], i) => (
                  <div key={i} className="split-group-row">
                    <b>File {i + 1}</b>
                    <span>{s === e ? `Halaman ${s + 1}` : `Halaman ${s + 1}-${e + 1}`}</span>
                    <small>{e - s + 1} halaman</small>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {mode === 'groups' && (
          <>
            <label className="split-field">
              <span className="split-field-label">Kelompok halaman</span>
              <textarea
                className="split-input"
                value={groupText}
                onChange={(e) => setGroupText(e.target.value)}
                placeholder={'Contoh: 1,3,5 | 2,6,9\nAtau satu kelompok per baris:\n1,3,5\n2,6,9'}
                rows={4}
                aria-describedby="group-hint"
              />
              <small id="group-hint" className="split-field-hint">Pisahkan kelompok dengan | atau ; atau baris baru. Pisahkan halaman dengan koma.</small>
            </label>
            {groupError ? (
              <div className="split-error" role="alert">{groupError}</div>
            ) : (
              <div className="split-preview-list">
                <div className="preview-heading"><span>Hasil pemisahan</span><small>{parsedGroups.filter((g) => g.length).length} file</small></div>
                {parsedGroups.filter((g) => g.length).map((group, i) => (
                  <div key={i} className="split-group-row">
                    <b>File {i + 1}</b>
                    <span>Halaman {group.map((p) => p + 1).join(', ')}</span>
                    <small>{group.length} halaman</small>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {outputCount > 1 && (
        <label className="split-zip-toggle">
          <input type="checkbox" checked={asZip} onChange={(e) => setAsZip(e.target.checked)} />
          <span>
            Kemas {outputCount} file ke dalam <strong>satu arsip ZIP</strong>
            <small>Lebih rapi daripada {outputCount} unduhan terpisah</small>
          </span>
        </label>
      )}

      <button className="primary" onClick={run} disabled={!canRun || busy}>
        {busy ? 'Memproses…' : mode === 'each' ? `Pisahkan ${selected.length} halaman${asZip && outputCount > 1 ? ' (ZIP)' : ''} →` : mode === 'ranges' ? `Pisahkan menjadi ${parsedRanges.length} file${asZip && outputCount > 1 ? ' (ZIP)' : ''} →` : `Pisahkan menjadi ${parsedGroups.filter((g) => g.length).length} file${asZip && outputCount > 1 ? ' (ZIP)' : ''} →`}
      </button>
    </div>
  );
}

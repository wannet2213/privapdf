import { useEffect, useState } from 'react';
import { listFormFields, fillForm, type FormFieldInfo } from '../engines/pdf-native';
import { PdfPreview } from '../lib/pdf-preview';
import { tr } from '../lib/i18n';

interface FormFillPanelProps {
  bytes: ArrayBuffer;
  onProcess: (output: ArrayBuffer) => void;
  busy: boolean;
}

/** Nilai tiap field: teks langsung; dropdown/radio/optionlist indeks pilihan ('' = tidak diubah); checkbox boolean ('' = tidak diubah). */
type FieldValue = string | boolean;

export function FormFillPanel({ bytes, onProcess, busy }: FormFillPanelProps) {
  const [fields, setFields] = useState<FormFieldInfo[]>([]);
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [preview, setPreview] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    setValues({});
    setPreview(null);
    listFormFields(bytes)
      .then((found) => {
        if (cancelled) return;
        setFields(found);
        setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : tr('Gagal membaca formulir.', 'Failed to read the form.'));
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [bytes]);

  const changed = Object.keys(values).length > 0;

  const apply = async () => {
    if (!changed) return;
    setError(undefined);
    // Kirim hanya field yang benar-benar diubah user.
    const payload: Record<string, string | number | boolean> = {};
    for (const [name, value] of Object.entries(values)) {
      if (value === '') continue;
      if (typeof value === 'boolean') payload[name] = value;
      else {
        const field = fields.find((f) => f.name === name);
        const index = Number(value);
        payload[name] = field?.options && Number.isInteger(index) && index >= 0 && index < field.options.length ? field.options[index] : value;
      }
    }
    try {
      const out = await fillForm(bytes, payload);
      setPreview(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('Gagal mengisi formulir.', 'Failed to fill the form.'));
    }
  };

  if (loading) return <div className="annotate-loading">{tr('Membaca field formulir…', 'Reading form fields…')}</div>;
  if (error && !fields.length) return <div className="preview-error" role="alert">{error}</div>;
  if (!fields.length) {
    return (
      <div className="split-panel">
        <p className="split-hint">{tr('PDF ini tidak memiliki field formulir yang bisa diisi (bukan AcroForm). Gunakan tool "Ratakan (flatten)" untuk mengunci anotasi, atau "Tanda tangan" untuk menulis manual.', 'This PDF has no fillable form fields (not AcroForm). Use the "Flatten" tool to lock annotations, or "Sign / stamp" to write by hand.')}</p>
      </div>
    );
  }

  return (
    <div className="split-panel">
      <div className="preview-heading">
        <span>{tr(`${fields.length} field ditemukan`, `${fields.length} field(s) found`)}</span>
        <small>{tr('Isi field, pratinjau muncul setelah diterapkan', 'Fill the fields, the preview appears once applied')}</small>
      </div>
      <div className="tool-form">
        {fields.map((field) => {
          const value = values[field.name] ?? '';
          if (field.type === 'checkbox') {
            return (
              <label key={field.name} className="tool-form-label" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={value === true}
                  disabled={busy}
                  onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.checked }))}
                />
                {field.name} {field.value === 'ya' && <small>{tr('(awal: terisi)', '(initially: checked)')}</small>}
              </label>
            );
          }
          if (field.options?.length) {
            return (
              <div key={field.name} className="tool-form-field">
                <label className="tool-form-label" htmlFor={`ff-${field.name}`}>{field.name} {field.value && <small>({tr('awal', 'initially')}: {field.value})</small>}</label>
                <select
                  id={`ff-${field.name}`}
                  className="tool-form-input"
                  value={typeof value === 'string' ? value : ''}
                  disabled={busy}
                  onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
                >
                  <option value="">{tr('— tidak diubah —', '— unchanged —')}</option>
                  {field.options.map((opt, i) => (
                    <option key={opt} value={String(i)}>{opt}</option>
                  ))}
                </select>
              </div>
            );
          }
          return (
            <div key={field.name} className="tool-form-field">
              <label className="tool-form-label" htmlFor={`ff-${field.name}`}>{field.name} {field.value && <small>({tr('awal', 'initially')}: {field.value})</small>}</label>
              <input
                id={`ff-${field.name}`}
                type="text"
                className="tool-form-input"
                value={typeof value === 'string' ? value : ''}
                disabled={busy}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
              />
            </div>
          );
        })}
      </div>
      {error && <div className="preview-error" role="alert">{error}</div>}
      <button className="primary" onClick={apply} disabled={busy || !changed}>
        {busy ? tr('Memproses…', 'Processing…') : tr('Terapkan isian →', 'Apply entries →')}
      </button>
      {preview && (
        <>
          <div className="preview-heading">
            <span>{tr('Pratinjau', 'Preview')}</span>
            <small>{tr('Hasil setelah isian diterapkan', 'Result after the entries are applied')}</small>
          </div>
          <PdfPreview bytes={preview} pages={[]} selected={[]} onToggle={() => {}} onMove={() => {}} />
          <button
            className="primary"
            disabled={busy}
            onClick={() => onProcess(preview)}
          >
            {tr('Unduh hasil →', 'Download result →')}
          </button>
        </>
      )}
    </div>
  );
}

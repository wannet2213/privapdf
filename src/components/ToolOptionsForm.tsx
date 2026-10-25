import { useState, type ReactNode } from 'react';
import { tr } from '../lib/i18n';

export type Field =
  | { name: string; label: string; type: 'text'; default?: string; placeholder?: string }
  | { name: string; label: string; type: 'number'; default?: number; min?: number; max?: number; step?: number }
  | { name: string; label: string; type: 'textarea'; default?: string; placeholder?: string; rows?: number }
  | { name: string; label: string; type: 'select'; default?: string; options: { value: string; label: string }[] }
  | { name: string; label: string; type: 'range'; default?: number; min?: number; max?: number; step?: number; unit?: string };

interface ToolOptionsFormProps {
  fields: Field[];
  onProcess: (values: Record<string, string | number>) => void;
  busy: boolean;
  submitLabel: string;
  /** Aksi kedua yang memakai nilai form yang sama (mis. unduh sebagai ZIP). */
  secondaryLabel?: string;
  onSecondary?: (values: Record<string, string | number>) => void;
  children?: ReactNode;
}

export function ToolOptionsForm({ fields, onProcess, busy, submitLabel, secondaryLabel, onSecondary, children }: ToolOptionsFormProps) {
  const [values, setValues] = useState<Record<string, string | number>>(() => {
    const init: Record<string, string | number> = {};
    for (const f of fields) {
      if (f.type === 'number' || f.type === 'range') init[f.name] = f.default ?? 0;
      else init[f.name] = f.default ?? '';
    }
    return init;
  });

  const set = (name: string, value: string | number) => setValues((prev) => ({ ...prev, [name]: value }));

  return (
    <div className="split-panel">
      <div className="tool-form">
        {fields.map((field) => (
          <div key={field.name} className="tool-form-field">
            {field.type !== 'range' && <label className="tool-form-label" htmlFor={`field-${field.name}`}>{field.label}</label>}
            {field.type === 'text' && (
              <input id={`field-${field.name}`} type="text" className="tool-form-input" value={values[field.name] as string} placeholder={field.placeholder} onChange={(e) => set(field.name, e.target.value)} />
            )}
            {field.type === 'number' && (
              <input id={`field-${field.name}`} type="number" className="tool-form-input" value={values[field.name] as number} min={field.min} max={field.max} step={field.step} onChange={(e) => set(field.name, Number(e.target.value))} />
            )}
            {field.type === 'textarea' && (
              <textarea id={`field-${field.name}`} className="tool-form-input" rows={field.rows ?? 3} value={values[field.name] as string} placeholder={field.placeholder} onChange={(e) => set(field.name, e.target.value)} />
            )}
            {field.type === 'select' && (
              <select id={`field-${field.name}`} className="tool-form-input" value={values[field.name] as string} onChange={(e) => set(field.name, e.target.value)}>
                {field.options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            )}
            {field.type === 'range' && (
              <div className="tool-form-range-row">
                <input id={`field-${field.name}`} type="range" min={field.min ?? 0} max={field.max ?? 100} step={field.step ?? 1} value={values[field.name] as number} onChange={(e) => set(field.name, Number(e.target.value))} />
                <span className="tool-form-range-value">{values[field.name]}{field.unit ?? ''}</span>
              </div>
            )}
          </div>
        ))}
        {children}
      </div>
      <button className="primary" onClick={() => onProcess(values)} disabled={busy}>
        {busy ? tr('Memproses…', 'Processing…') : submitLabel}
      </button>
      {secondaryLabel && onSecondary && (
        <button className="ghost-btn" onClick={() => onSecondary(values)} disabled={busy}>
          {secondaryLabel}
        </button>
      )}
    </div>
  );
}

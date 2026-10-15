import type { ReactElement } from 'react';

// Warna ikon per tool — konsisten di Home, Tools, dan warna file merge.
export const TOOL_COLORS: Record<string, string> = {
  merge: '#E5322D',
  split: '#3B6FE0',
  'delete-pages': '#E84393',
  'reorder-pages': '#0E9F9F',
  rotate: '#E88C30',
  'page-numbers': '#8B5CF6',
  watermark: '#3B6FE0',
  crop: '#2FA36B',
  compress: '#0E9F9F',
  unlock: '#E88C30',
  protect: '#E88C30',
  metadata: '#8B5CF6',
  'pdf-to-image': '#2FA36B',
  'extract-text': '#3B6FE0',
  sign: '#8B5CF6',
  'fill-form': '#2FA36B',
  flatten: '#535A6C',
  'image-to-pdf': '#E84393',
  'image-toolkit': '#0E9F9F',
  'image-watermark': '#3B6FE0',
  'remove-bg': '#E84393',
  'office-to-pdf': '#E5322D',
};

const ICONS: Record<string, ReactElement> = {
  merge: (<><rect x="3" y="3" width="10" height="13" rx="1.6" /><rect x="11" y="8" width="10" height="13" rx="1.6" /><path d="M14 14.5h4" /></>),
  split: (<><path d="M12 3v18" strokeDasharray="2.4 2.4" /><rect x="3" y="3" width="6.5" height="18" rx="1.6" /><rect x="14.5" y="3" width="6.5" height="18" rx="1.6" /></>),
  'delete-pages': (<><path d="M6 3h8.5L19 7.5V21H6z" /><path d="M14.5 3v4.5H19" /><path d="M9.5 13.5h5" /></>),
  'reorder-pages': (<><path d="M8 20V7" /><path d="M5 10l3-3 3 3" /><path d="M16 4v13" /><path d="M13 14l3 3 3-3" /></>),
  rotate: (<><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 3v4.5h-4.5" /></>),
  'page-numbers': (<><path d="M6 3h8.5L19 7.5V21H6z" /><path d="M14.5 3v4.5H19" /><path d="M10 16.5v-5l-1.6 1" /></>),
  watermark: (<><path d="M6 3h8.5L19 7.5V21H6z" /><path d="M12.5 10.2c1.7 2.1 2.7 3.3 2.7 4.6a2.7 2.7 0 1 1-5.4 0c0-1.3 1-2.5 2.7-4.6z" /></>),
  crop: (<><path d="M7 2.5V17h14.5" /><path d="M2.5 7H17v14.5" /></>),
  compress: (<><path d="M9 3.5V9H3.5" /><path d="M15 3.5V9h5.5" /><path d="M9 20.5V15H3.5" /><path d="M15 20.5V15h5.5" /></>),
  unlock: (<><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 7.7-1.5" /><path d="M12 14.5v2.5" /></>),
  protect: (<><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /><path d="M12 14.5v2.5" /></>),
  metadata: (<><path d="M6 3h8.5L19 7.5V21H6z" /><path d="M14.5 3v4.5H19" /><path d="M12 11v5" /><path d="M12 8h.01" strokeWidth={2.6} /></>),
  'pdf-to-image': (<><path d="M6 3h8.5L19 7.5V21H6z" /><circle cx="10" cy="10.5" r="1.4" /><path d="M7.5 17.5l3.5-3.5 2.5 2.5 1.5-1.5 1.5 1.5" /></>),
  'extract-text': (<><path d="M6 3h8.5L19 7.5V21H6z" /><path d="M9.5 12h5" /><path d="M9.5 15.5h5" /><path d="M9.5 8.5h2.5" /></>),
  sign: (<><path d="M6 3h8.5L19 7.5V21H6z" /><path d="M14.5 3v4.5H19" /><path d="M9 16c1.2-1.8 2.2 1.6 3.4-.2 1-1.5 1.8.9 2.6-.4" /></>),
  'fill-form': (<><path d="M6 3h8.5L19 7.5V21H6z" /><path d="M14.5 3v4.5H19" /><path d="M9 13.5h6" /><path d="M9 16.5h4" /><path d="M9 10.5h.01" strokeWidth={2.6} /></>),
  flatten: (<><path d="M12 4 4.5 8 12 12l7.5-4z" /><path d="M4.5 13 12 17l7.5-4" /></>),
  'image-to-pdf': (<><rect x="2.5" y="4" width="12.5" height="12.5" rx="2" /><circle cx="6.8" cy="8.3" r="1.3" /><path d="M3.5 14.5l3.5-3.5 3 3 1.8-1.8 2.7 2.7" /><path d="M18.5 8.5V17a3 3 0 0 1-3 3H8" /></>),
  'image-toolkit': (<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15.5 16 10.5 5 21" /><path d="M8 21h13" strokeDasharray="2.5 2.5" /></>),
  'image-watermark': (<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M12 7.7c1.9 2.3 3 3.7 3 5.1a3 3 0 1 1-6 0c0-1.4 1.1-2.8 3-5.1z" /></>),
  'remove-bg': (<><path d="M6 3h8.5L19 7.5V21H6z" /><path d="M14.5 3v4.5H19" /><path d="M9.5 13.5 13.5 9.5" /><path d="m13 7 4 4" /><path d="M8.5 17.5h.01" strokeWidth={2.6} /></>),
  'office-to-pdf': (<><rect x="3.5" y="3.5" width="17" height="17" rx="2" /><path d="M3.5 9.5h17" /><path d="M9.5 9.5v11" /></>),
};

const FALLBACK: ReactElement = (<><path d="M6 3h8.5L19 7.5V21H6z" /><path d="M14.5 3v4.5H19" /></>);

export function ToolIcon({ id }: { id: string }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[id] ?? FALLBACK}
    </svg>
  );
}

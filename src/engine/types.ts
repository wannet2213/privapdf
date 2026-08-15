export type Operation =
  | 'merge' | 'merge-pages' | 'split' | 'rotate' | 'image-to-pdf' | 'pdf-to-image' | 'office-to-pdf'
  | 'delete-pages' | 'reorder-pages' | 'page-numbers' | 'watermark'
  | 'metadata' | 'crop' | 'compress' | 'unlock' | 'extract-text';
export type Phase = 'validate' | 'load engine' | 'process' | 'sanitize' | 'finalize';

export type SplitMode = 'each' | 'ranges' | 'groups';

export interface SplitOptions {
  mode?: SplitMode;
  indices?: number[];
  ranges?: [number, number][];
  groups?: number[][];
  filename?: string;
  /** Kemas semua output menjadi satu file ZIP (hanya berlaku bila output > 1). */
  asZip?: boolean;
}

export type JobRequest = {
  jobId: string;
  operation: Operation;
  inputs: ArrayBuffer[];
  options?: Record<string, unknown>;
};

export type JobEvent = {
  jobId: string;
  type: 'progress' | 'result' | 'error';
  phase?: Phase;
  progress?: number;
  outputs?: ArrayBuffer[];
  outputNames?: string[];
  error?: string;
};

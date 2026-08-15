import type { JobRequest, JobEvent, Operation } from './types';

export const PROTOCOL_VERSION = 1;
const operations: Operation[] = [
  'merge', 'merge-pages', 'split', 'rotate', 'image-to-pdf', 'pdf-to-image', 'office-to-pdf',
  'delete-pages', 'reorder-pages', 'page-numbers', 'watermark', 'metadata', 'crop', 'compress', 'unlock', 'extract-text',
];

export function isJobRequest(value: unknown): value is JobRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<JobRequest>;
  return (
    typeof request.jobId === 'string' &&
    operations.includes(request.operation as Operation) &&
    Array.isArray(request.inputs) &&
    request.inputs.every((input) => input instanceof ArrayBuffer)
  );
}

export function errorEvent(jobId: string, error: string): JobEvent {
  return { jobId, type: 'error', error };
}

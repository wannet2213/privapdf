import { describe, expect, it } from 'vitest';
import { errorEvent, isJobRequest, PROTOCOL_VERSION } from '../../src/engine/protocol';

describe('worker protocol', () => {
  it('accepts supported transferable requests', () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(
      isJobRequest({
        jobId: 'job-1',
        operation: 'office-to-pdf',
        inputs: [new ArrayBuffer(1)],
      }),
    ).toBe(true);
  });

  it('rejects unknown operations and malformed inputs', () => {
    expect(isJobRequest({ jobId: 'job-1', operation: 'unknown', inputs: [] })).toBe(false);
    expect(isJobRequest({ jobId: 'job-1', operation: 'merge', inputs: [{}] })).toBe(false);
  });

  it('serializes a stable error event', () => {
    expect(errorEvent('job-1', 'failed')).toEqual({
      jobId: 'job-1',
      type: 'error',
      error: 'failed',
    });
  });
});

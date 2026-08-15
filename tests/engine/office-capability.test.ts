import { describe, expect, it } from 'vitest';
import { officeCapability } from '../../src/engines/office-native';

describe('office capability', () => {
  it('reports runtime capability without claiming unsupported environments', () => {
    const capability = officeCapability();
    expect(typeof capability.available).toBe('boolean');
    expect(capability.reason).toMatch(/WASM|COOP|WebAssembly|Worker/);
  });
});

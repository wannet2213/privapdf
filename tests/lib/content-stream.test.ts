import { describe, expect, it } from 'vitest';
import { parseOps, spliceOps } from '../../src/lib/content-stream';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => String.fromCharCode(...b);

describe('parseOps', () => {
  it('parses operands, strings with escapes/nesting, hex, arrays, and dicts', () => {
    const ops = parseOps(enc('BT /F1 12 Tf 1 0 0 1 72.5 -.5 Tm (a\\(b\\) (c) \\101\\n) Tj [<48656C> -120 (lo)] TJ ET /P <</MCID 3 /op 1>> BDC EMC'));
    expect(ops.map((o) => o.operator)).toEqual(['BT', 'Tf', 'Tm', 'Tj', 'TJ', 'ET', 'BDC', 'EMC']);
    expect(ops[1].operands).toEqual(['F1', 12]);
    expect(ops[2].operands).toEqual([1, 0, 0, 1, 72.5, -0.5]);
    expect(dec(ops[3].operands[0] as Uint8Array)).toBe('a(b) (c) A\n');
    const tj = ops[4].operands[0] as (Uint8Array | number)[];
    expect([dec(tj[0] as Uint8Array), tj[1], dec(tj[2] as Uint8Array)]).toEqual(['Hel', -120, 'lo']);
    // Dict operand dengan kunci "op" tidak boleh tertukar dengan token operator.
    expect(ops[6].operands).toEqual(['P', { MCID: 3, op: 1 }]);
  });

  it('skips comments and binary inline image data containing EI-like bytes', () => {
    const data = 'xxEIxx\nEIy'; // "EI" tanpa spasi pengapit bukan akhir data
    const ops = parseOps(enc(`% komentar (bukan string\nq BI /W 2 /H 1 /BPC 8 /CS /G ID ${data} EI Q (s) Tj`));
    expect(ops.map((o) => o.operator)).toEqual(['q', 'BI', 'Q', 'Tj']);
  });

  it('records byte ranges so one op can be replaced without touching the rest', () => {
    const src = enc('BT /F1 9 Tf (lama) Tj 0 -12 Td (tetap) Tj ET');
    const ops = parseOps(src);
    const out = spliceOps(src, new Map([[ops.find((o) => o.operator === 'Tj')!, '[-1500] TJ']]));
    expect(dec(out)).toBe('BT /F1 9 Tf [-1500] TJ 0 -12 Td (tetap) Tj ET');
  });
});

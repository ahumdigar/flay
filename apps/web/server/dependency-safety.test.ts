import { Buffer } from 'node:buffer';
import { toBigIntBE, toBigIntLE, toBufferBE, toBufferLE } from '../vendor/bigint-buffer/index.cjs';
import { describe, expect, it } from 'vitest';

describe('bounded bigint buffer compatibility', () => {
  it('round-trips both byte orders without native code', () => {
    const value = 0x0102030405060708n;
    expect(toBigIntBE(toBufferBE(value, 8))).toBe(value);
    expect(toBigIntLE(toBufferLE(value, 8))).toBe(value);
    expect(toBigIntLE(Buffer.from([1, 0]))).toBe(1n);
  });

  it('rejects overflow, negative values, and invalid widths', () => {
    expect(() => toBufferBE(256n, 1)).toThrow(/does not fit/);
    expect(() => toBufferLE(-1n, 8)).toThrow(/non-negative/);
    expect(() => toBufferBE(1n, -1)).toThrow(/Width/);
  });
});

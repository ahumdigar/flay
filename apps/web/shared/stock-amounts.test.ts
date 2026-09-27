import { describe, expect, it } from 'vitest';
import { normalizeMultiplier, scaledAtomicToDecimal, scaledDecimalToAtomic } from './stock-amounts.js';

describe('xStocks Scaled UI Amount conversion', () => {
  it('converts raw atomic units to displayed shares without floating point', () => {
    expect(scaledAtomicToDecimal('1000000', 6, '1.0032690125398187')).toBe('1.003269012539');
  });

  it('converts displayed sell shares conservatively back to raw atomic units', () => {
    const result = scaledDecimalToAtomic('1', 6, '1.0032690125398187');
    expect(result.amountAtomic).toBe('996741');
    expect(BigInt(result.amountAtomic)).toBeLessThan(1_000_000n);
    expect(Number(result.normalizedDisplayAmount)).toBeLessThanOrEqual(1);
  });

  it('rejects dust and excess precision', () => {
    expect(() => scaledDecimalToAtomic('0.000000000001', 6, '1.003')).toThrow(/smallest executable unit/);
    expect(() => scaledDecimalToAtomic('0.1234567890123456789', 6, '1')).toThrow(/18 decimal places/);
  });

  it('normalizes scientific notation from a bounded provider number', () => {
    expect(normalizeMultiplier(1e-7)).toBe('0.0000001');
  });

  it('keeps negative onchain deltas signed for Activity', () => {
    expect(scaledAtomicToDecimal('-996741', 6, '1.0032690125398187')).toBe('-0.999999358827');
  });
});

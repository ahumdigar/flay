import { describe, expect, it } from 'vitest';
import { atomicToDecimal, compareAtomic, decimalToAtomic, formatTokenAmount } from './amounts.js';

describe('exact token amount conversion', () => {
  it('converts decimal user input without floating-point loss', () => {
    expect(decimalToAtomic('1.000001', 6)).toBe('1000001');
    expect(decimalToAtomic('0.000000001', 9)).toBe('1');
    expect(decimalToAtomic('18446744073.709551615', 9)).toBe('18446744073709551615');
  });

  it('rejects ambiguous or over-precise input', () => {
    expect(() => decimalToAtomic('1e3', 9)).toThrow(/positive number/);
    expect(() => decimalToAtomic('1,000', 9)).toThrow(/positive number/);
    expect(() => decimalToAtomic('-1', 9)).toThrow(/positive number/);
    expect(() => decimalToAtomic('0.0000001', 6)).toThrow(/at most 6/);
  });

  it('formats positive and negative atomic deltas exactly', () => {
    expect(atomicToDecimal('1234500', 6)).toBe('1.2345');
    expect(atomicToDecimal(-5000n, 6)).toBe('-0.005');
    expect(atomicToDecimal('7', 0)).toBe('7');
    expect(formatTokenAmount('123456789', 6, 3)).toBe('123.457');
  });

  it('compares values as integers beyond JavaScript safe-number range', () => {
    expect(compareAtomic('9007199254740993', '9007199254740992')).toBe(1);
    expect(compareAtomic('42', '42')).toBe(0);
  });
});

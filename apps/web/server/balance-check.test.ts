import { describe, expect, it } from 'vitest';
import type { TokenInfo } from '../shared/types.js';
import { assertSpendableBalance } from './balance-check.js';

const sol: TokenInfo = {
  mint: 'So11111111111111111111111111111111111111112',
  symbol: 'SOL', name: 'Solana', decimals: 9, logoUri: null, tokenProgram: 'native',
  verified: true, tags: [], extensions: [], tradable: true, blockedReason: null, usdPrice: null,
};

describe('pre-sign spendability', () => {
  it('requires trade principal plus SOL fee and rent reserve', () => {
    expect(() => assertSpendableBalance(sol, '10000000', 15_000_000n)).not.toThrow();
    expect(() => assertSpendableBalance(sol, '10000000', 14_999_999n))
      .toThrowError(/more SOL/);
  });

  it('requires both an input token balance and SOL for a token trade', () => {
    const usdc: TokenInfo = { ...sol, symbol: 'USDC', tokenProgram: 'spl-token' };
    expect(() => assertSpendableBalance(usdc, '6000000', 5_000_000n, 6_000_000n)).not.toThrow();
    expect(() => assertSpendableBalance(usdc, '6000000', 5_000_000n, 5_999_999n))
      .toThrowError(/enough confirmed USDC/);
    expect(() => assertSpendableBalance(usdc, '6000000', 4_999_999n, 6_000_000n))
      .toThrowError(/more SOL/);
  });

  it('can check principal without a SOL reserve while Jupiter determines sponsorship', () => {
    const usdc: TokenInfo = { ...sol, symbol: 'USDC', tokenProgram: 'spl-token' };
    expect(() => assertSpendableBalance(usdc, '190000', 0n, 191379n, 0n)).not.toThrow();
    expect(() => assertSpendableBalance(usdc, '190000', 0n, 189999n, 0n))
      .toThrowError(/enough confirmed USDC/);
    expect(() => assertSpendableBalance(sol, '3000000', 3_000_000n, undefined, 0n)).not.toThrow();
    expect(() => assertSpendableBalance(sol, '3000000', 2_999_999n, undefined, 0n))
      .toThrowError(/more SOL/);
  });
});

import { describe, expect, it } from 'vitest';
import { SOL_MINT, USDC_MINT } from '../shared/constants.js';
import type { QuoteResponse } from '../shared/types.js';
import { isCurrentQuoteResponse } from './quote-state.js';

const quote = {
  inputToken: { mint: SOL_MINT },
  outputToken: { mint: USDC_MINT },
  quotes: [{ inAmount: '10000000', slippageBps: 50, expiresAt: 2_000 }],
} as QuoteResponse;

describe('visible quote binding', () => {
  it('keeps a quote only for its exact form values and before expiry', () => {
    expect(isCurrentQuoteResponse(quote, SOL_MINT, USDC_MINT, '0.01', 9, 50, 1_000)).toBe(true);
    expect(isCurrentQuoteResponse(quote, SOL_MINT, USDC_MINT, '0.02', 9, 50, 1_000)).toBe(false);
    expect(isCurrentQuoteResponse(quote, USDC_MINT, SOL_MINT, '0.01', 9, 50, 1_000)).toBe(false);
    expect(isCurrentQuoteResponse(quote, SOL_MINT, USDC_MINT, '0.01', 9, 100, 1_000)).toBe(false);
    expect(isCurrentQuoteResponse(quote, SOL_MINT, USDC_MINT, '0.01', 9, 50, 2_000)).toBe(false);
    expect(isCurrentQuoteResponse(quote, SOL_MINT, USDC_MINT, 'bad', 9, 50, 1_000)).toBe(false);
  });
});

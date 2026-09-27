import { describe, expect, it } from 'vitest';
import type { MarketQuote, QuoteProvider, QuoteResponse } from '../shared/types.js';
import { ApiClientError } from './lib/api.js';
import {
  automaticPreparationFailure,
  isAutoMarketFallbackFailure,
  marketPrepareCandidates,
  prepareMarketCandidates,
  shouldTryNextMarketRoute,
} from './market-prepare.js';

function route(id: string, provider: QuoteProvider): MarketQuote {
  return { id, provider } as MarketQuote;
}

const jupiter = route('jupiter-route', 'jupiter');
const raydium = route('raydium-route', 'raydium');
const orca = route('orca-route', 'orca');
const response = { quotes: [jupiter, raydium, orca] } as QuoteResponse;

describe('market preparation candidates', () => {
  it('keeps Auto in ranked order and includes each current quote once', () => {
    expect(marketPrepareCandidates(response, jupiter, 'auto').map((quote) => quote.id))
      .toEqual(['jupiter-route', 'raydium-route', 'orca-route']);
    expect(marketPrepareCandidates({ ...response, quotes: [jupiter, jupiter, raydium] }, jupiter, 'auto').map((quote) => quote.id))
      .toEqual(['jupiter-route', 'raydium-route']);
  });

  it('keeps manual selection isolated to its selected venue', () => {
    expect(marketPrepareCandidates(response, raydium, 'raydium')).toEqual([raydium]);
    expect(marketPrepareCandidates(response, null, 'auto')).toEqual([]);
  });

  it('advances only after an eligible venue-local API failure in Auto mode', () => {
    const retryable = new ApiClientError('Jupiter failed.', 'PROVIDER_REJECTED', 502, true);
    const rejectedNoRoute = new ApiClientError('Failed to get quotes', 'PROVIDER_REJECTED', 400, false);
    const final = new ApiClientError('Balance is short.', 'INSUFFICIENT_BALANCE', 409, false);
    const unsafe = new ApiClientError('Transaction mismatch.', 'PROVIDER_TRANSACTION_INVALID', 502, true);
    expect(shouldTryNextMarketRoute('auto', retryable, 0, 3)).toBe(true);
    expect(shouldTryNextMarketRoute('jupiter', retryable, 0, 3)).toBe(false);
    expect(shouldTryNextMarketRoute('auto', final, 0, 3)).toBe(false);
    expect(shouldTryNextMarketRoute('auto', new Error('local failure'), 0, 3)).toBe(false);
    expect(shouldTryNextMarketRoute('auto', retryable, 2, 3)).toBe(false);
    expect(isAutoMarketFallbackFailure('auto', retryable)).toBe(true);
    expect(isAutoMarketFallbackFailure('auto', rejectedNoRoute)).toBe(true);
    expect(isAutoMarketFallbackFailure('auto', final)).toBe(false);
    expect(isAutoMarketFallbackFailure('auto', unsafe)).toBe(false);
  });

  it('bounds the exhausted Auto error to three user-safe provider messages', () => {
    const failure = automaticPreparationFailure([
      { provider: 'jupiter', error: new ApiClientError('Failed to get quotes', 'PROVIDER_REJECTED', 502, true) },
      { provider: 'raydium', error: new ApiClientError('Temporary failure', 'PROVIDER_UNAVAILABLE', 502, true) },
      { provider: 'orca', error: new ApiClientError('x'.repeat(400), 'PROVIDER_UNAVAILABLE', 502, true) },
    ]);
    expect(failure.message).toContain('Jupiter: Failed to get quotes');
    expect(failure.message).toContain('Raydium: Temporary failure');
    expect(failure.message.length).toBeLessThan(500);
  });

  it('tries ranked Auto candidates once and stops at the first exact preparation success', async () => {
    const attempted: string[] = [];
    const prepared = await prepareMarketCandidates([jupiter, raydium, orca], 'auto', async (candidate) => {
      attempted.push(candidate.id);
      if (candidate.provider === 'jupiter') throw new ApiClientError('Failed to get quotes', 'PROVIDER_REJECTED', 400, false);
      return { provider: candidate.provider, transaction: 'exact-raydium-transaction' };
    });
    expect(attempted).toEqual(['jupiter-route', 'raydium-route']);
    expect(prepared).toEqual({ provider: 'raydium', transaction: 'exact-raydium-transaction' });
  });

  it('does not try another route after a balance failure or in manual mode', async () => {
    const attempted: string[] = [];
    await expect(prepareMarketCandidates([jupiter, raydium], 'auto', async (candidate) => {
      attempted.push(candidate.id);
      throw new ApiClientError('Balance is short.', 'INSUFFICIENT_SOL', 409, false);
    })).rejects.toMatchObject({ code: 'INSUFFICIENT_SOL' });
    expect(attempted).toEqual(['jupiter-route']);

    attempted.length = 0;
    await expect(prepareMarketCandidates([jupiter], 'jupiter', async (candidate) => {
      attempted.push(candidate.id);
      throw new ApiClientError('Failed to get quotes', 'PROVIDER_REJECTED', 400, false);
    })).rejects.toMatchObject({ code: 'PROVIDER_REJECTED' });
    expect(attempted).toEqual(['jupiter-route']);
  });
});

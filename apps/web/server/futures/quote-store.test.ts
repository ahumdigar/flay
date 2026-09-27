import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FuturesIntent, FuturesRouteQuote } from '../../shared/futures.js';
import { AppError } from '../errors.js';
import { FuturesQuoteStore } from './quote-store.js';

const intent: FuturesIntent = {
  wallet: '11111111111111111111111111111111',
  market: 'SOL-PERP',
  side: 'short',
  orderType: 'limit',
  collateralAtomic: '1000000',
  leverageBps: 10_000,
  limitPriceMicroUsd: '100000000',
  slippageBps: 50,
  routeChoice: 'phoenix',
};

function storedQuote(expiresAt: number): FuturesRouteQuote {
  return {
    id: 'quote-id',
    venue: 'phoenix',
    market: intent.market,
    nativeMarketAddress: intent.wallet,
    side: intent.side,
    orderType: intent.orderType,
    collateralAtomic: intent.collateralAtomic,
    notionalMicroUsd: '1000000',
    baseSizeAtomic: '10000000',
    baseDecimals: 9,
    entryPriceMicroUsd: '100000000',
    acceptablePriceMicroUsd: '100000000',
    liquidationPriceMicroUsd: null,
    openingFeeMicroUsd: '600',
    executionFeeLamports: null,
    networkFeeLamports: '5000',
    accountRentLamports: null,
    immediateCostMicroUsd: '600',
    priceImpactBps: 0,
    fundingRateBpsHourly: null,
    borrowingRateBpsHourly: null,
    setupSteps: [],
    executionEligible: true,
    exclusionCode: null,
    exclusionReason: null,
    sourceSlot: '1',
    fetchedAt: Date.now(),
    expiresAt,
  };
}

afterEach(() => vi.useRealTimers());

describe('wallet-bound futures quote records', () => {
  it('returns an immutable wallet-bound record', () => {
    const store = new FuturesQuoteStore();
    store.put(intent, storedQuote(Date.now() + 10_000));
    const first = store.get('quote-id', intent.wallet);
    first.quote.collateralAtomic = '999';
    expect(store.get('quote-id', intent.wallet).quote.collateralAtomic).toBe('1000000');
    expect(() => store.get('quote-id', 'SysvarRent111111111111111111111111111111111')).toThrowError(AppError);
  });

  it('rejects an expired quote with a retryable 410', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T00:00:00Z'));
    const store = new FuturesQuoteStore();
    store.put(intent, storedQuote(Date.now() + 1_000));
    vi.advanceTimersByTime(1_001);
    try {
      store.get('quote-id', intent.wallet);
      throw new Error('expected expiry');
    } catch (error) {
      expect(error).toMatchObject({ status: 410, code: 'FUTURES_QUOTE_EXPIRED', retryable: true });
    }
  });
});

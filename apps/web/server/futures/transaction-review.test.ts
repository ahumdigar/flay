import { describe, expect, it, vi } from 'vitest';
import type { FuturesIntent, FuturesPrepareRequest, FuturesRouteQuote, FuturesVenuePortfolio } from '../../shared/futures.js';
import type { FuturesService } from './futures-service.js';
import { FuturesQuoteStore } from './quote-store.js';
import { FuturesTransactionService } from './transaction-service.js';

const wallet = '11111111111111111111111111111111';
const intent: FuturesIntent = {
  wallet,
  market: 'SOL-PERP',
  side: 'long',
  orderType: 'market',
  collateralAtomic: '1000000',
  leverageBps: 20_000,
  slippageBps: 50,
  routeChoice: 'gmtrade',
};

function quote(overrides: Partial<FuturesRouteQuote> = {}): FuturesRouteQuote {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    venue: 'gmtrade',
    market: intent.market,
    nativeMarketAddress: 'Gmso1uvJnLbawvw7yezdfCDcPydwW2s2iqG3w6MDucLo',
    side: intent.side,
    orderType: intent.orderType,
    collateralAtomic: intent.collateralAtomic,
    notionalMicroUsd: '2000000',
    baseSizeAtomic: '20000000',
    baseDecimals: 9,
    entryPriceMicroUsd: '100000000',
    acceptablePriceMicroUsd: '100500000',
    liquidationPriceMicroUsd: '55000000',
    openingFeeMicroUsd: '1200',
    executionFeeLamports: '300000',
    networkFeeLamports: null,
    accountRentLamports: null,
    immediateCostMicroUsd: null,
    priceImpactBps: null,
    fundingRateBpsHourly: null,
    borrowingRateBpsHourly: null,
    setupSteps: [],
    executionEligible: true,
    exclusionCode: null,
    exclusionReason: null,
    sourceSlot: null,
    fetchedAt: now,
    expiresAt: now + 10_000,
    ...overrides,
  };
}

function emptyPortfolio(): FuturesVenuePortfolio {
  return {
    venue: 'gmtrade', available: true, collateralAtomic: '0', withdrawableAtomic: '0',
    positions: [], orders: [], orphanedConditionals: [], history: [], error: null, fetchedAt: Date.now(),
  };
}

function harness(original: FuturesRouteQuote, fresh: FuturesRouteQuote) {
  const quotes = new FuturesQuoteStore();
  quotes.put(intent, original);
  const portfolio = emptyPortfolio();
  const futures = {
    quotes,
    routeQuotes: vi.fn().mockResolvedValue({
      intent,
      quotes: [fresh, quote({ venue: 'phoenix', executionEligible: false, exclusionCode: 'PHOENIX_ONBOARDING_REQUIRED', exclusionReason: 'Onboarding required' })],
      recommendedVenue: 'gmtrade',
      recommendationLabel: 'Only available route',
      warnings: [],
      requestedAt: Date.now(),
    }),
    portfolio: vi.fn().mockResolvedValue({
      wallet, walletSolLamports: '10000000', walletUsdcAtomic: '1000000',
      walletBalancesStale: false, walletBalancesFetchedAt: Date.now(), walletBalancesError: null,
      venues: { phoenix: { ...portfolio, venue: 'phoenix' }, gmtrade: portfolio }, fetchedAt: Date.now(),
    }),
    gmtrade: { prepareAction: vi.fn() },
  } as unknown as FuturesService;
  return { service: new FuturesTransactionService(futures), futures, portfolio };
}

describe('fresh exact Futures review', () => {
  it('rejects a request that changes the venue fixed by the selected quote', async () => {
    const original = quote();
    const { service, futures } = harness(original, original);
    await expect(service.prepare({
      wallet, action: 'open', venue: 'phoenix', quoteId: original.id, market: intent.market, idempotencyKey: crypto.randomUUID(),
    })).rejects.toMatchObject({ code: 'FUTURES_VENUE_CHANGED' });
    expect(futures.routeQuotes).not.toHaveBeenCalled();
  });

  it('rejects a market that differs from the wallet-bound quote', async () => {
    const original = quote();
    const { service, futures } = harness(original, original);
    await expect(service.prepare({
      wallet, action: 'open', venue: 'gmtrade', quoteId: original.id, market: 'BTC-PERP', idempotencyKey: crypto.randomUUID(),
    })).rejects.toMatchObject({ code: 'FUTURES_MARKET_CHANGED' });
    expect(futures.routeQuotes).not.toHaveBeenCalled();
    expect(futures.gmtrade.prepareAction).not.toHaveBeenCalled();
  });

  it('refreshes every candidate, keeps the selected venue fixed, and rejects movement beyond its reviewed bound', async () => {
    const original = quote();
    const fresh = quote({ entryPriceMicroUsd: '100500001' });
    const { service, futures } = harness(original, fresh);
    await expect(service.prepare({
      wallet, action: 'open', venue: 'gmtrade', quoteId: original.id, market: intent.market, idempotencyKey: crypto.randomUUID(),
    })).rejects.toMatchObject({ code: 'FUTURES_PRICE_MOVED', retryable: true });
    expect(futures.routeQuotes).toHaveBeenCalledWith(intent);
    expect(futures.gmtrade.prepareAction).not.toHaveBeenCalled();
  });
  it('derives recovery markets from authoritative native orders and conditionals', async () => {
    const original = quote();
    const { service, futures, portfolio } = harness(original, original);
    portfolio.orders.push({
      venue: 'gmtrade', nativeId: 'native-order', market: 'SOL-PERP', side: 'long', orderType: 'limit',
      sizeAtomic: '10', remainingSizeAtomic: '10', baseDecimals: 9, limitPriceMicroUsd: '100000000',
      reduceOnly: false, status: 'resting', createdAt: null, updatedAt: Date.now(),
    });
    portfolio.orphanedConditionals.push({
      venue: 'gmtrade', nativeId: 'native-conditional', market: 'ETH-PERP', kind: 'take-profit',
      triggerPriceMicroUsd: '110000000', executionPriceMicroUsd: '109500000', sizeAtomic: '10',
      orphaned: true, status: 'open',
    });
    const observedMarkets: string[] = [];
    vi.mocked(futures.gmtrade.prepareAction).mockImplementation(async (input) => {
      const request = (input as { request: FuturesPrepareRequest }).request;
      observedMarkets.push(request.market ?? 'missing');
      throw new Error('stop after normalization');
    });

    await expect(service.prepare({
      wallet, action: 'cancel', venue: 'gmtrade', nativeId: 'native-order', market: 'BTC-PERP', idempotencyKey: crypto.randomUUID(),
    })).rejects.toThrow('stop after normalization');
    await expect(service.prepare({
      wallet, action: 'cancel-conditional', venue: 'gmtrade', nativeId: 'native-conditional', market: 'BTC-PERP', idempotencyKey: crypto.randomUUID(),
    })).rejects.toThrow('stop after normalization');
    expect(observedMarkets).toEqual(['SOL-PERP', 'ETH-PERP']);
  });

});

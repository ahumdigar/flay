import { describe, expect, it } from 'vitest';
import type { FuturesIntent, FuturesRouteQuote, FuturesVenueMarket } from '../../shared/futures.js';
import {
  baseSizeForNotional,
  compareEligibleQuotes,
  liquidationEstimate,
  notionalForIntent,
} from './domain.js';

const intent: FuturesIntent = {
  wallet: '11111111111111111111111111111111',
  market: 'SOL-PERP',
  side: 'long',
  orderType: 'market',
  collateralAtomic: '5000000',
  leverageBps: 20_000,
  slippageBps: 50,
  routeChoice: 'auto',
};

const market: FuturesVenueMarket = {
  venue: 'phoenix',
  nativeSymbol: 'SOL',
  marketAddress: '11111111111111111111111111111111',
  baseDecimals: 9,
  priceDecimals: 6,
  maximumLeverageBps: 100_000,
  active: true,
  markPriceMicroUsd: '100000000',
  bidPriceMicroUsd: '99900000',
  askPriceMicroUsd: '100100000',
  fundingRateBpsHourly: null,
  openingFeeBps: 6,
  sourceSlot: '1',
  fetchedAt: Date.now(),
  unavailableReason: null,
};

function quote(venue: 'phoenix' | 'gmtrade', cost: string | null, eligible = true): FuturesRouteQuote {
  return {
    id: venue,
    venue,
    market: intent.market,
    nativeMarketAddress: market.marketAddress,
    side: intent.side,
    orderType: intent.orderType,
    collateralAtomic: intent.collateralAtomic,
    notionalMicroUsd: '10000000',
    baseSizeAtomic: '100000000',
    baseDecimals: 9,
    entryPriceMicroUsd: '100000000',
    acceptablePriceMicroUsd: '100500000',
    liquidationPriceMicroUsd: '52500000',
    openingFeeMicroUsd: '6000',
    executionFeeLamports: '5000',
    networkFeeLamports: '5000',
    accountRentLamports: null,
    immediateCostMicroUsd: cost,
    priceImpactBps: 0,
    fundingRateBpsHourly: null,
    borrowingRateBpsHourly: null,
    setupSteps: [],
    executionEligible: eligible,
    exclusionCode: eligible ? null : 'UNAVAILABLE',
    exclusionReason: eligible ? null : 'Unavailable',
    sourceSlot: '1',
    fetchedAt: Date.now(),
    expiresAt: Date.now() + 10_000,
  };
}

describe('futures fixed-point domain', () => {
  it('derives notional and base size without floating point', () => {
    expect(notionalForIntent(intent)).toBe(10_000_000n);
    expect(baseSizeForNotional(10_000_000n, 100_000_000n, 9)).toBe(100_000_000n);
  });

  it('estimates liquidation on the adverse side', () => {
    expect(liquidationEstimate(100_000_000n, 'long', 20_000)).toBe(55_000_000n);
    expect(liquidationEstimate(100_000_000n, 'short', 20_000)).toBe(145_000_000n);
  });
});

describe('fair futures routing', () => {
  it('covers no-route and one-route states', () => {
    expect(compareEligibleQuotes([quote('phoenix', null, false), quote('gmtrade', null, false)])).toEqual({ venue: null, label: 'No route' });
    expect(compareEligibleQuotes([quote('phoenix', '5000'), quote('gmtrade', null, false)])).toEqual({ venue: 'phoenix', label: 'Only available route' });
  });

  it('requires manual choice when an eligible cost is incomparable', () => {
    expect(compareEligibleQuotes([quote('phoenix', '5000'), quote('gmtrade', null)])).toEqual({ venue: null, label: 'Choose a venue' });
  });

  it('excludes a stale route without hiding a current peer route', () => {
    const stale = { ...quote('phoenix', '1000', false), exclusionCode: 'STALE_DATA', exclusionReason: 'Phoenix market data is stale.' };
    expect(compareEligibleQuotes([stale, quote('gmtrade', '5000')])).toEqual({ venue: 'gmtrade', label: 'Only available route' });
    expect(compareEligibleQuotes([stale])).toEqual({ venue: null, label: 'No route' });
  });

  it('selects the lower cost and uses Phoenix for a negligible verified tie', () => {
    expect(compareEligibleQuotes([quote('phoenix', '7000'), quote('gmtrade', '5000')])).toEqual({ venue: 'gmtrade', label: 'Best route' });
    expect(compareEligibleQuotes([quote('phoenix', '5500'), quote('gmtrade', '5000')])).toEqual({ venue: 'phoenix', label: 'Best route' });
  });
});

describe('near-tie build reliability', () => {
  it('uses a verified higher build success rate before Phoenix priority', () => {
    const phoenix = quote('phoenix', '100000');
    const gmtrade = quote('gmtrade', '100500');
    expect(compareEligibleQuotes([phoenix, gmtrade], {
      phoenix: { attempts: 4, successes: 2 },
      gmtrade: { attempts: 5, successes: 5 },
    }).venue).toBe('gmtrade');
    expect(compareEligibleQuotes([phoenix, gmtrade], {
      phoenix: { attempts: 2, successes: 2 },
      gmtrade: { attempts: 5, successes: 5 },
    }).venue).toBe('phoenix');
  });
});

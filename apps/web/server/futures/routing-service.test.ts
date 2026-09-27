import { describe, expect, it, vi } from 'vitest';
import type {
  FuturesIntent,
  FuturesRouteQuote,
  FuturesVenueMarket,
} from '../../shared/futures.js';
import type { TokenService } from '../tokens.js';
import { FuturesService } from './futures-service.js';

const wallet = '11111111111111111111111111111111';
const readiness = { publicData: true, execution: true, status: 'ready', detail: 'ready', checkedAt: 1 } as const;
function venueMarket(venue: 'phoenix' | 'gmtrade', symbol: string, address: string): FuturesVenueMarket {
  return {
    venue,
    nativeSymbol: symbol,
    marketAddress: address,
    baseDecimals: symbol === 'SOL' ? 9 : 8,
    priceDecimals: 6,
    maximumLeverageBps: 100_000,
    active: true,
    markPriceMicroUsd: '100000000',
    bidPriceMicroUsd: null,
    askPriceMicroUsd: null,
    fundingRateBpsHourly: null,
    openingFeeBps: 6,
    sourceSlot: '1',
    fetchedAt: Date.now(),
    unavailableReason: null,
  };
}
function route(venue: 'phoenix' | 'gmtrade', intent: FuturesIntent, eligible: boolean, cost: string | null): FuturesRouteQuote {
  return {
    id: venue + '-quote',
    venue,
    market: intent.market,
    nativeMarketAddress: venue + '-market',
    side: intent.side,
    orderType: intent.orderType,
    collateralAtomic: intent.collateralAtomic,
    notionalMicroUsd: '2000000',
    baseSizeAtomic: '20000000',
    baseDecimals: 9,
    entryPriceMicroUsd: '100000000',
    acceptablePriceMicroUsd: intent.limitPriceMicroUsd ?? '100500000',
    liquidationPriceMicroUsd: null,
    openingFeeMicroUsd: '1200',
    executionFeeLamports: venue === 'gmtrade' ? '300000' : null,
    networkFeeLamports: null,
    accountRentLamports: null,
    immediateCostMicroUsd: cost,
    priceImpactBps: null,
    fundingRateBpsHourly: null,
    borrowingRateBpsHourly: null,
    setupSteps: [],
    executionEligible: eligible,
    exclusionCode: eligible ? null : 'PHOENIX_ONBOARDING_REQUIRED',
    exclusionReason: eligible ? null : 'Phoenix public onboarding is required.',
    sourceSlot: '1',
    fetchedAt: Date.now(),
    expiresAt: Date.now() + 10_000,
  };
}

function service() {
  const instance = new FuturesService({} as TokenService);
  vi.spyOn(instance.phoenix, 'readiness').mockResolvedValue(readiness);
  vi.spyOn(instance.gmtrade, 'readiness').mockResolvedValue(readiness);
  return instance;
}

describe('normalized two-venue Futures routing', () => {
  it('publishes every active venue market and preserves distinct native market ids', async () => {
    const instance = service();
    vi.spyOn(instance.phoenix, 'markets').mockResolvedValue([
      venueMarket('phoenix', 'SOL', 'phoenix-sol'),
      venueMarket('phoenix', 'BTC', 'phoenix-btc'),
    ]);
    vi.spyOn(instance.gmtrade, 'markets').mockResolvedValue([
      venueMarket('gmtrade', 'SOL', 'gm-sol'),
      venueMarket('gmtrade', 'ETH', 'gm-eth'),
    ]);
    const registry = await instance.markets();
    expect(registry.markets.map((market) => market.symbol)).toEqual(['SOL-PERP', 'BTC-PERP', 'ETH-PERP']);
    expect(registry.markets[0].venues.phoenix?.marketAddress).toBe('phoenix-sol');
    expect(registry.markets[0].venues.gmtrade?.marketAddress).toBe('gm-sol');
    expect(registry.markets[1].activeVenues).toEqual(['phoenix']);
    expect(registry.markets[2].activeVenues).toEqual(['gmtrade']);
  });

  it.each([
    ['long', 'market', undefined],
    ['short', 'market', undefined],
    ['long', 'limit', '99000000'],
    ['short', 'limit', '101000000'],
  ] as const)('compares the same %s %s request and excludes inaccessible Phoenix', async (side, orderType, limitPriceMicroUsd) => {
    const instance = service();
    vi.spyOn(instance.phoenix, 'markets').mockResolvedValue([venueMarket('phoenix', 'SOL', 'phoenix-sol')]);
    vi.spyOn(instance.gmtrade, 'markets').mockResolvedValue([venueMarket('gmtrade', 'SOL', 'gm-sol')]);
    const intent: FuturesIntent = {
      wallet,
      market: 'SOL-PERP',
      side,
      orderType,
      collateralAtomic: '1000000',
      leverageBps: 20_000,
      ...(limitPriceMicroUsd ? { limitPriceMicroUsd } : {}),
      slippageBps: 50,
      routeChoice: 'auto',
    };
    const phoenix = vi.spyOn(instance.phoenix, 'quote').mockResolvedValue(route('phoenix', intent, false, '1000'));
    const gmtrade = vi.spyOn(instance.gmtrade, 'quote').mockResolvedValue(route('gmtrade', intent, true, null));
    const response = await instance.routeQuotes(intent);
    expect(phoenix).toHaveBeenCalledWith(intent, expect.objectContaining({ marketAddress: 'phoenix-sol' }));
    expect(gmtrade).toHaveBeenCalledWith(intent, expect.objectContaining({ marketAddress: 'gm-sol' }));
    expect(response).toMatchObject({ recommendedVenue: 'gmtrade', recommendationLabel: 'Only available route' });
  });

  it('ranks both eligible routes after converting the GMTrade keeper fee to USD', async () => {
    const instance = service();
    vi.spyOn(instance.phoenix, 'markets').mockResolvedValue([venueMarket('phoenix', 'SOL', 'phoenix-sol')]);
    vi.spyOn(instance.gmtrade, 'markets').mockResolvedValue([venueMarket('gmtrade', 'SOL', 'gm-sol')]);
    const intent: FuturesIntent = {
      wallet,
      market: 'SOL-PERP',
      side: 'long',
      orderType: 'market',
      collateralAtomic: '1000000',
      leverageBps: 20_000,
      slippageBps: 50,
      routeChoice: 'auto',
    };
    vi.spyOn(instance.phoenix, 'quote').mockResolvedValue(route('phoenix', intent, true, '50000'));
    vi.spyOn(instance.gmtrade, 'quote').mockResolvedValue(route('gmtrade', intent, true, '10000'));

    const gmWinner = await instance.routeQuotes(intent);
    expect(gmWinner).toMatchObject({ recommendedVenue: 'gmtrade', recommendationLabel: 'Best route' });
    expect(gmWinner.quotes.find((quote) => quote.venue === 'gmtrade')?.immediateCostMicroUsd).toBe('40000');

    vi.mocked(instance.gmtrade.quote).mockResolvedValue(route('gmtrade', intent, true, '30000'));
    const phoenixWinner = await instance.routeQuotes(intent);
    expect(phoenixWinner).toMatchObject({ recommendedVenue: 'phoenix', recommendationLabel: 'Best route' });
  });
});

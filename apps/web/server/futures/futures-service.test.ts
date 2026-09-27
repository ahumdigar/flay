import { describe, expect, it, vi } from 'vitest';
import { PhoenixHttpError } from '@ellipsis-labs/rise';
import { SOL_MINT, USDC_MINT } from '../../shared/constants.js';
import type { FuturesIntent, FuturesRouteQuote, FuturesVenueMarket, FuturesVenuePortfolio } from '../../shared/futures.js';
import type { TokenService } from '../tokens.js';
import { excludedQuote } from './domain.js';
import { FuturesService, includeLamportFeesInImmediateCost, phoenixCollateralAtomic, phoenixParentWithdrawableAtomic } from './futures-service.js';

function gmPortfolio(): FuturesVenuePortfolio {
  return {
    venue: 'gmtrade',
    available: true,
    collateralAtomic: '1000000',
    withdrawableAtomic: '0',
    positions: [{
      venue: 'gmtrade',
      nativeId: 'position',
      market: 'SOL-PERP',
      side: 'long',
      sizeAtomic: '10000000',
      baseDecimals: 9,
      collateralAtomic: '1000000',
      entryPriceMicroUsd: '100000000',
      markPriceMicroUsd: '101000000',
      liquidationPriceMicroUsd: null,
      unrealizedPnlMicroUsd: '10000',
      leverageBps: 10_000,
      conditionals: [],
      updatedAt: Date.now(),
    }],
    orders: [],
    orphanedConditionals: [],
    history: [],
    error: null,
    fetchedAt: Date.now(),
  };
}

function registeredPhoenixAccess() {
  return {
    wallet: '11111111111111111111111111111111', publicData: true, activated: true,
    traderRegistered: true, executionEligible: true, status: 'active' as const,
    message: 'Phoenix execution is active.', onboardingUrl: 'https://docs.phoenix.trade/sdk/register', checkedAt: Date.now(),
  };
}


describe('Phoenix parent collateral safety', () => {
  it('keeps Phoenix collateral in its provider-reported atomic USDC units', () => {
    expect(phoenixCollateralAtomic('1020000')).toBe('1020000');
    expect(phoenixCollateralAtomic('0')).toBe('0');
    expect(() => phoenixCollateralAtomic('1.02')).toThrowError(expect.objectContaining({ code: 'PHOENIX_COLLATERAL_INVALID' }));
  });

  it('uses only portfolio 0 for the withdrawal ceiling', () => {
    const view = (ui: string, immediate = true) => ({
      capabilities: { withdrawCollateral: { immediate } },
      effectiveCollateralForWithdrawals: { ui },
    });
    expect(phoenixParentWithdrawableAtomic(new Map([
      [0, view('1.250001')],
      [1, view('99')],
    ]))).toBe('1250001');
    expect(phoenixParentWithdrawableAtomic(new Map([
      [0, view('1', false)],
      [1, view('99')],
    ]))).toBe('0');
    expect(phoenixParentWithdrawableAtomic(new Map([[1, view('99')]]))).toBe('0');
  });
});

describe('Comparable futures costs', () => {
  it('converts keeper lamports to micro-USD and fails closed without a SOL reference', () => {
    const quote = {
      executionFeeLamports: '300000', networkFeeLamports: null, immediateCostMicroUsd: '4000',
    } as FuturesRouteQuote;
    expect(includeLamportFeesInImmediateCost(quote, '100000000').immediateCostMicroUsd).toBe('34000');
    expect(includeLamportFeesInImmediateCost(quote, null).immediateCostMicroUsd).toBeNull();
  });
});

describe('Futures provider recovery state', () => {
  it('returns healthy venue state when the independent wallet RPC read fails', async () => {
    const tokens = { balances: vi.fn().mockRejectedValue(new Error('Solana RPC: 429')) } as unknown as TokenService;
    const service = new FuturesService(tokens);
    const phoenix = { ...gmPortfolio(), venue: 'phoenix' as const, collateralAtomic: '1020000' };
    vi.spyOn(service as unknown as { phoenixPortfolio(wallet: string): Promise<FuturesVenuePortfolio> }, 'phoenixPortfolio').mockResolvedValue(phoenix);
    vi.spyOn(service.gmtradeState, 'portfolio').mockResolvedValue(gmPortfolio());

    const result = await service.portfolio('11111111111111111111111111111111');

    expect(result).toMatchObject({
      walletSolLamports: null,
      walletUsdcAtomic: null,
      walletBalancesStale: false,
      walletBalancesFetchedAt: null,
      venues: { phoenix: { available: true, collateralAtomic: '1020000' } },
    });
    expect(result.walletBalancesError).toContain('429');
  });

  it('labels a bounded last verified wallet balance as cached after an RPC failure', async () => {
    const tokens = {
      balances: vi.fn()
        .mockResolvedValueOnce({ balances: [
          { token: { mint: SOL_MINT }, amountAtomic: '2000000' },
          { token: { mint: USDC_MINT }, amountAtomic: '13001' },
        ] })
        .mockRejectedValueOnce(new Error('Solana RPC: 429')),
    } as unknown as TokenService;
    const service = new FuturesService(tokens);
    vi.spyOn(service as unknown as { phoenixPortfolio(wallet: string): Promise<FuturesVenuePortfolio> }, 'phoenixPortfolio').mockResolvedValue({ ...gmPortfolio(), venue: 'phoenix' });
    vi.spyOn(service.gmtradeState, 'portfolio').mockResolvedValue(gmPortfolio());

    await service.portfolio('11111111111111111111111111111111');
    const result = await service.portfolio('11111111111111111111111111111111');

    expect(result).toMatchObject({
      walletSolLamports: '2000000',
      walletUsdcAtomic: '13001',
      walletBalancesStale: true,
    });
    expect(result.walletBalancesError).toContain('last verified');
  });

  it('returns an empty Phoenix portfolio before onboarding without calling the trader HTTP endpoint', async () => {
    const tokens = {
      balances: vi.fn().mockResolvedValue({ balances: [{ token: { mint: USDC_MINT }, amountAtomic: '5000000' }] }),
    } as unknown as TokenService;
    const service = new FuturesService(tokens);
    vi.spyOn(service.phoenix, 'access').mockResolvedValue({
      ...registeredPhoenixAccess(), activated: false, traderRegistered: false, executionEligible: false,
      status: 'onboarding-required', message: 'Phoenix public onboarding is required.',
    });
    const traderState = vi.spyOn(service.phoenix, 'traderState');
    vi.spyOn(service.gmtradeState, 'portfolio').mockResolvedValue(gmPortfolio());

    const result = (await service.portfolio('11111111111111111111111111111111')).venues.phoenix;

    expect(result).toMatchObject({ available: true, collateralAtomic: '0', positions: [], error: null });
    expect(traderState).not.toHaveBeenCalled();
  });

  it('treats Phoenix trader-not-found as an authoritative empty pre-onboarding portfolio', async () => {
    const tokens = {
      balances: vi.fn().mockResolvedValue({ balances: [{ token: { mint: USDC_MINT }, amountAtomic: '5000000' }] }),
    } as unknown as TokenService;
    const service = new FuturesService(tokens);
    const missingTrader = new PhoenixHttpError(
      404,
      'GET /v1/trader/state/wallet failed with HTTP 404',
      'Trader not found for provided authority and trader_pda_index',
      undefined,
      { error: 'Trader not found for provided authority and trader_pda_index' },
    );
    vi.spyOn(service.phoenix, 'access').mockResolvedValue(registeredPhoenixAccess());
    vi.spyOn(service.phoenix, 'traderState').mockRejectedValue(missingTrader);
    const history = vi.spyOn(service.phoenix, 'tradeHistory');
    vi.spyOn(service.gmtradeState, 'portfolio').mockResolvedValue(gmPortfolio());

    const result = (await service.portfolio('11111111111111111111111111111111')).venues.phoenix;

    expect(result).toMatchObject({
      venue: 'phoenix', available: true, collateralAtomic: '0', withdrawableAtomic: '0',
      positions: [], orders: [], orphanedConditionals: [], history: [], error: null,
    });
    expect(history).not.toHaveBeenCalled();
  });

  it('keeps unrelated Phoenix 404 responses in degraded recovery mode', async () => {
    const tokens = {
      balances: vi.fn().mockResolvedValue({ balances: [{ token: { mint: USDC_MINT }, amountAtomic: '5000000' }] }),
    } as unknown as TokenService;
    const service = new FuturesService(tokens);
    vi.spyOn(service.phoenix, 'access').mockResolvedValue(registeredPhoenixAccess());
    vi.spyOn(service.phoenix, 'traderState').mockRejectedValue(new PhoenixHttpError(
      404,
      'GET /v1/trader/state/wallet failed with HTTP 404',
      'Different resource was not found',
      undefined,
      { error: 'Different resource was not found' },
    ));
    vi.spyOn(service.gmtradeState, 'portfolio').mockResolvedValue(gmPortfolio());

    const result = (await service.portfolio('11111111111111111111111111111111')).venues.phoenix;

    expect(result.available).toBe(false);
    expect(result.error).toContain('failed with HTTP 404');
  });

  it('keeps last authoritative positions reachable during a provider outage', async () => {
    const tokens = {
      balances: vi.fn().mockResolvedValue({ balances: [{ token: { mint: USDC_MINT }, amountAtomic: '5000000' }] }),
    } as unknown as TokenService;
    const service = new FuturesService(tokens);
    vi.spyOn(service.phoenix, 'access').mockResolvedValue(registeredPhoenixAccess());
    vi.spyOn(service.phoenix, 'traderState').mockRejectedValue(new Error('Phoenix unavailable'));
    vi.spyOn(service.gmtradeState, 'portfolio')
      .mockResolvedValueOnce(gmPortfolio())
      .mockRejectedValueOnce(new Error('GMTrade unavailable'));

    expect((await service.portfolio('11111111111111111111111111111111')).venues.gmtrade.available).toBe(true);
    const duringOutage = (await service.portfolio('11111111111111111111111111111111')).venues.gmtrade;
    expect(duringOutage.available).toBe(false);
    expect(duringOutage.positions).toHaveLength(1);
    expect(duringOutage.error).toContain('GMTrade unavailable');
  });

  it('keeps a healthy venue tradable from the last-known intersection when its peer is down', async () => {
    const tokens = { balances: vi.fn() } as unknown as TokenService;
    const service = new FuturesService(tokens);
    const market = (venue: 'phoenix' | 'gmtrade') => ({
      venue,
      nativeSymbol: 'SOL',
      nativeMarketName: 'SOL/USD',
      marketAddress: venue === 'phoenix' ? 'phoenix-market' : 'gm-market',
      marketTokenAddress: venue === 'gmtrade' ? 'gm-token' : undefined,
      baseDecimals: 9,
      priceDecimals: 6,
      maximumLeverageBps: 100_000,
      active: true,
      markPriceMicroUsd: '100000000',
      bidPriceMicroUsd: '99900000',
      askPriceMicroUsd: '100100000',
      fundingRateBpsHourly: null,
      borrowingRateBpsHourly: null,
      openingFeeBps: null,
      executionFeeLamports: null,
      sourceSlot: '1',
      fetchedAt: Date.now(),
      unavailableReason: null,
    });
    vi.spyOn(service.phoenix, 'markets').mockResolvedValue([market('phoenix')]);
    vi.spyOn(service.gmtrade, 'markets').mockResolvedValueOnce([market('gmtrade')]).mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(service.phoenix, 'readiness').mockResolvedValue({ publicData: true, execution: false, status: 'onboarding-required', detail: 'wallet onboarding is checked later', checkedAt: Date.now() });
    vi.spyOn(service.gmtrade, 'readiness')
      .mockResolvedValueOnce({ publicData: true, execution: true, status: 'ready', detail: 'ready', checkedAt: Date.now() })
      .mockResolvedValueOnce({ publicData: false, execution: false, status: 'unavailable', detail: 'offline', checkedAt: Date.now() });

    expect((await service.markets()).markets[0].activeVenues).toEqual(['phoenix', 'gmtrade']);
    const outage = await service.markets();
    expect(outage.markets[0].activeVenues).toEqual(['phoenix']);
    expect(outage.markets[0].venues.gmtrade).toMatchObject({ active: false, unavailableReason: 'offline' });
  });

  it('publishes a healthy Phoenix market when GMTrade fails before any cache exists', async () => {
    const tokens = { balances: vi.fn() } as unknown as TokenService;
    const service = new FuturesService(tokens);
    const phoenixMarket: FuturesVenueMarket = {
      venue: 'phoenix', nativeSymbol: 'SOL', marketAddress: 'phoenix-market', baseDecimals: 9,
      priceDecimals: 6, maximumLeverageBps: 100_000, active: true, markPriceMicroUsd: '100000000',
      bidPriceMicroUsd: null, askPriceMicroUsd: null, fundingRateBpsHourly: null, openingFeeBps: 4,
      sourceSlot: '1', fetchedAt: Date.now(), unavailableReason: null,
    };
    vi.spyOn(service.phoenix, 'markets').mockResolvedValue([phoenixMarket]);
    vi.spyOn(service.gmtrade, 'markets').mockRejectedValue(new Error('offline'));
    vi.spyOn(service.phoenix, 'readiness').mockResolvedValue({ publicData: true, execution: false, status: 'onboarding-required', detail: 'onboarding required', checkedAt: Date.now() });
    vi.spyOn(service.gmtrade, 'readiness').mockResolvedValue({ publicData: false, execution: false, status: 'unavailable', detail: 'offline', checkedAt: Date.now() });

    const result = await service.markets();

    expect(result.markets).toHaveLength(1);
    expect(result.markets[0]).toMatchObject({ symbol: 'SOL-PERP', activeVenues: ['phoenix'] });
  });


  it('keeps a healthy quote route when the peer quote provider fails', async () => {
    const tokens = { balances: vi.fn() } as unknown as TokenService;
    const service = new FuturesService(tokens);
    const venueMarket = (venue: 'phoenix' | 'gmtrade'): FuturesVenueMarket => ({
      venue,
      nativeSymbol: 'SOL',
      nativeMarketName: 'SOL/USD',
      marketAddress: venue === 'phoenix' ? 'phoenix-market' : 'gm-market',
      marketTokenAddress: venue === 'gmtrade' ? 'gm-token' : undefined,
      baseDecimals: 9,
      priceDecimals: 6,
      maximumLeverageBps: 100_000,
      active: true,
      markPriceMicroUsd: '100000000',
      bidPriceMicroUsd: '99900000',
      askPriceMicroUsd: '100100000',
      fundingRateBpsHourly: null,
      openingFeeBps: null,
      sourceSlot: '1',
      fetchedAt: Date.now(),
      unavailableReason: null,
    });
    const phoenixMarket = venueMarket('phoenix');
    const gmMarket = venueMarket('gmtrade');
    vi.spyOn(service, 'markets').mockResolvedValue({
      markets: [{
        symbol: 'SOL-PERP', displayName: 'Solana perpetual', baseSymbol: 'SOL', quoteSymbol: 'USD',
        logoUri: null, baseDecimals: 9, venues: { phoenix: phoenixMarket, gmtrade: gmMarket },
        activeVenues: ['phoenix', 'gmtrade'], fetchedAt: Date.now(),
      }],
      venueReadiness: {
        phoenix: { publicData: true, execution: false, status: 'onboarding-required', detail: 'onboarding required', checkedAt: Date.now() },
        gmtrade: { publicData: true, execution: true, status: 'ready', detail: 'ready', checkedAt: Date.now() },
      },
      fetchedAt: Date.now(),
    });
    const intent: FuturesIntent = {
      wallet: '11111111111111111111111111111111', market: 'SOL-PERP', side: 'long', orderType: 'market',
      collateralAtomic: '1000000', leverageBps: 20_000, slippageBps: 50, routeChoice: 'auto',
    };
    vi.spyOn(service.phoenix, 'quote').mockRejectedValue(new Error('Phoenix quote offline'));
    vi.spyOn(service.gmtrade, 'quote').mockResolvedValue({
      ...excludedQuote('gmtrade', intent, gmMarket, 'unused', 'unused'),
      executionEligible: true,
      exclusionCode: null,
      exclusionReason: null,
      entryPriceMicroUsd: '100000000',
      acceptablePriceMicroUsd: '100500000',
      baseSizeAtomic: '20000000',
      immediateCostMicroUsd: null,
    });

    const result = await service.routeQuotes(intent);
    expect(result.quotes).toHaveLength(2);
    expect(result.quotes.find((quote) => quote.venue === 'phoenix')).toMatchObject({
      executionEligible: false,
      exclusionCode: 'PHOENIX_UNAVAILABLE',
      exclusionReason: 'Phoenix quote offline',
    });
    expect(result.recommendedVenue).toBe('gmtrade');
    expect(result.recommendationLabel).toBe('Only available route');
  });

});

import { Keypair, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { ticksToUsdWithMarketParams } from '@ellipsis-labs/rise';
import type {
  FuturesCandlesResponse,
  FuturesIntent,
  FuturesMarket,
  FuturesMarketsResponse,
  FuturesPortfolio,
  FuturesQuotesResponse,
  FuturesRouteQuote,
  FuturesVenue,
  FuturesVenueMarket,
  FuturesVenuePortfolio,
  PhoenixAccess,
} from '../../shared/futures.js';
import { SOL_MINT, USDC_MINT } from '../../shared/constants.js';
import type { TokenService } from '../tokens.js';
import { AppError } from '../errors.js';
import { withRpcFallback } from '../rpc.js';
import { compareEligibleQuotes, excludedQuote } from './domain.js';
import { GmTradeAdapter } from './gmtrade-adapter.js';
import { isPhoenixTraderNotFound, PhoenixAdapter } from './phoenix-adapter.js';
import { FuturesQuoteStore } from './quote-store.js';
import { futuresBuildReliability } from './build-reliability.js';

const MARKET_META: Record<string, { name: string; logo: string }> = {
  SOL: { name: 'Solana perpetual', logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png' },
  BTC: { name: 'Bitcoin perpetual', logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/bitcoin/info/logo.png' },
  ETH: { name: 'Ethereum perpetual', logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
};

function failedPortfolio(venue: FuturesVenue, error: unknown, fallback?: FuturesVenuePortfolio): FuturesVenuePortfolio {
  return {
    venue,
    available: false,
    collateralAtomic: fallback?.collateralAtomic ?? '0',
    withdrawableAtomic: fallback?.withdrawableAtomic ?? '0',
    positions: fallback?.positions ?? [],
    orders: fallback?.orders ?? [],
    orphanedConditionals: fallback?.orphanedConditionals ?? [],
    history: fallback?.history ?? [],
    error: error instanceof Error ? error.message : `${venue} portfolio is unavailable.`,
    fetchedAt: Date.now(),
  };
}

function decimalStringToAtomic(value: string, decimals: number): string {
  const match = value.trim().match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return '0';
  const fraction = (match[3] ?? '').padEnd(decimals, '0').slice(0, decimals);
  const result = BigInt(match[2]) * 10n ** BigInt(decimals) + BigInt(fraction || '0');
  return `${match[1]}${result}`;
}

export function phoenixCollateralAtomic(value: string): string {
  if (!/^-?\d+$/.test(value)) throw new AppError(502, 'PHOENIX_COLLATERAL_INVALID', 'Phoenix returned an invalid collateral amount.', true);
  return BigInt(value).toString();
}

function priceToMicro(value: string | undefined): string {
  if (!value) return '0';
  return decimalStringToAtomic(value, 6);
}

export function includeLamportFeesInImmediateCost(
  quote: FuturesRouteQuote,
  solPriceMicroUsd: string | null,
): FuturesRouteQuote {
  if (quote.immediateCostMicroUsd === null) return quote;
  const lamports = BigInt(quote.executionFeeLamports ?? '0') + BigInt(quote.networkFeeLamports ?? '0');
  if (lamports === 0n) return quote;
  if (solPriceMicroUsd === null) return { ...quote, immediateCostMicroUsd: null };
  const feeMicroUsd = lamports * BigInt(solPriceMicroUsd) / 1_000_000_000n;
  return { ...quote, immediateCostMicroUsd: (BigInt(quote.immediateCostMicroUsd) + feeMicroUsd).toString() };
}

interface PhoenixWithdrawalView {
  capabilities: { withdrawCollateral: { immediate: boolean } };
  effectiveCollateralForWithdrawals: { ui: string };
}

export function phoenixParentWithdrawableAtomic(views: ReadonlyMap<number, PhoenixWithdrawalView>): string {
  const parent = views.get(0);
  if (!parent?.capabilities.withdrawCollateral.immediate) return '0';
  return decimalStringToAtomic(parent.effectiveCollateralForWithdrawals.ui, 6);
}

interface FuturesDiagnostics {
  checkedAt: number;
  phoenixPublic: Awaited<ReturnType<PhoenixAdapter['readiness']>>;
  gmtrade: Awaited<ReturnType<GmTradeAdapter['readiness']>>;
  candles: { available: boolean; fresh: boolean; latestCandleAt: number | null; detail: string };
  rpc: { available: boolean; detail: string };
  simulation: { available: boolean; detail: string };
  gmtradeProcess: ReturnType<GmTradeAdapter['diagnostics']>;
  phoenixStream: ReturnType<PhoenixAdapter['diagnostics']>;
}

interface WalletBalanceState {
  walletSolLamports: string | null;
  walletUsdcAtomic: string | null;
  walletBalancesStale: boolean;
  walletBalancesFetchedAt: number | null;
  walletBalancesError: string | null;
}

const WALLET_BALANCE_FALLBACK_MS = 30 * 60_000;

export class FuturesService {
  readonly phoenix = new PhoenixAdapter();
  readonly gmtrade = new GmTradeAdapter();
  readonly gmtradeState = new GmTradeAdapter();
  readonly quotes = new FuturesQuoteStore();
  private diagnosticsCache: { at: number; value: FuturesDiagnostics } | null = null;
  private readonly portfolioCache = new Map<string, { at: number; value: FuturesVenuePortfolio }>();
  private readonly walletBalanceCache = new Map<string, { at: number; sol: string; usdc: string }>();
  private readonly venueMarketCache = new Map<FuturesVenue, { at: number; value: FuturesVenueMarket[] }>();

  constructor(private readonly tokens: TokenService) {}

  async markets(): Promise<FuturesMarketsResponse> {
    const gmSnapshot = (async () => {
      const result = await this.gmtrade.markets().then((value) => ({ ok: true as const, value })).catch(() => ({ ok: false as const }));
      const readiness = await this.gmtrade.readiness();
      return { result, readiness };
    })();
    const [phoenixResult, phoenixReadiness, gm] = await Promise.all([
      this.phoenix.markets().then((value) => ({ ok: true as const, value })).catch(() => ({ ok: false as const })),
      this.phoenix.readiness(),
      gmSnapshot,
    ]);
    const gmResult = gm.result;
    const gmReadiness = gm.readiness;
    const lastKnown = (venue: FuturesVenue, result: { ok: true; value: FuturesVenueMarket[] } | { ok: false }, detail: string) => {
      if (result.ok) {
        this.venueMarketCache.set(venue, { at: Date.now(), value: structuredClone(result.value) });
        return result.value;
      }
      const cached = this.venueMarketCache.get(venue);
      if (!cached || Date.now() - cached.at > 30 * 60_000) return [];
      return cached.value.map((market) => ({ ...market, active: false, unavailableReason: detail }));
    };
    const phoenixMarkets = lastKnown('phoenix', phoenixResult, phoenixReadiness.detail).map((market) => phoenixReadiness.publicData ? market : {
      ...market,
      active: false,
      unavailableReason: phoenixReadiness.detail,
    });
    const effectiveGmMarkets = lastKnown('gmtrade', gmResult, gmReadiness.detail).map((market) => gmReadiness.execution ? market : {
      ...market,
      active: false,
      unavailableReason: gmReadiness.detail,
    });
    const bySymbol = new Map<string, Partial<Record<FuturesVenue, FuturesVenueMarket>>>();
    for (const market of [...phoenixMarkets, ...effectiveGmMarkets]) {
      const symbol = market.nativeSymbol.replace(/[-/]?PERP$/i, '').toUpperCase();
      const current = bySymbol.get(symbol) ?? {};
      current[market.venue] = market;
      bySymbol.set(symbol, current);
    }
    const fetchedAt = Date.now();
    const priority = ['SOL', 'BTC', 'ETH'];
    const markets: FuturesMarket[] = [...bySymbol].filter(([, venues]) => Boolean(
      (venues.phoenix || venues.gmtrade) && (venues.phoenix?.active || venues.gmtrade?.active),
    )).sort(([a], [b]) => priority.indexOf(a) - priority.indexOf(b)).map(([baseSymbol, venues]) => {
      const rows = Object.values(venues).filter((item): item is FuturesVenueMarket => Boolean(item));
      const metadata = MARKET_META[baseSymbol];
      return {
        symbol: `${baseSymbol}-PERP`, displayName: metadata?.name ?? `${baseSymbol} perpetual`, baseSymbol,
        quoteSymbol: 'USD', logoUri: metadata?.logo ?? null,
        baseDecimals: Math.max(...rows.map((row) => row.baseDecimals)), venues,
        activeVenues: rows.filter((row) => row.active).map((row) => row.venue), fetchedAt,
      };
    });
    return { markets, venueReadiness: { phoenix: phoenixReadiness, gmtrade: gmReadiness }, fetchedAt };
  }

  candles(symbol: string, interval: Parameters<PhoenixAdapter['candles']>[1]): Promise<FuturesCandlesResponse> {
    return this.phoenix.candles(symbol, interval);
  }

  access(wallet: string): Promise<PhoenixAccess> {
    return this.phoenix.access(wallet);
  }

  async quoteVenue(intent: FuturesIntent, venue: FuturesVenue) {
    const registry = await this.markets();
    const market = registry.markets.find((item) => item.symbol === intent.market);
    const venueMarket = market?.venues[venue];
    if (!venueMarket) throw new AppError(503, 'FUTURES_VENUE_MARKET_UNAVAILABLE', `${venue} does not currently expose this launch market.`, true);
    return venue === 'phoenix' ? this.phoenix.quote(intent, venueMarket) : this.gmtrade.quote(intent, venueMarket);
  }

  async routeQuotes(intent: FuturesIntent): Promise<FuturesQuotesResponse> {
    const registry = await this.markets();
    const market = registry.markets.find((item) => item.symbol === intent.market);
    if (!market) throw new AppError(404, 'FUTURES_MARKET_NOT_FOUND', 'This futures market is not active on a configured venue.');
    const tasks = (['phoenix', 'gmtrade'] as const).flatMap((venue) => {
      const venueMarket = market.venues[venue];
      if (!venueMarket || !venueMarket.active) return [];
      const operation = venue === 'phoenix' ? this.phoenix.quote(intent, venueMarket) : this.gmtrade.quote(intent, venueMarket);
      return [operation.catch((error: unknown) => excludedQuote(
        venue,
        intent,
        venueMarket,
        `${venue.toUpperCase()}_UNAVAILABLE`,
        error instanceof Error ? error.message : `${venue} quote is unavailable.`,
      ))];
    });
    const rawResults = await Promise.all(tasks);
    const sol = registry.markets.find((item) => item.symbol === 'SOL-PERP');
    const solPriceMicroUsd = sol?.venues.phoenix?.markPriceMicroUsd ?? sol?.venues.gmtrade?.markPriceMicroUsd ?? null;
    const results = rawResults.map((quote) => includeLamportFeesInImmediateCost(quote, solPriceMicroUsd));
    for (const quote of results) this.quotes.put(intent, quote);
    const recommendation = compareEligibleQuotes(results, futuresBuildReliability());
    const requestedAt = Date.now();
    return {
      intent, quotes: results, recommendedVenue: recommendation.venue, recommendationLabel: recommendation.label,
      warnings: [
        'Perpetual futures can liquidate your collateral. Use only funds you can afford to lose.',
        'Funding and borrowing can change after entry and are not included in route ranking.',
      ],
      requestedAt,
    };
  }

  async portfolio(wallet: string): Promise<FuturesPortfolio> {
    const [balances, phoenix, gmtrade] = await Promise.all([
      this.loadWalletBalances(wallet),
      this.loadVenuePortfolio(wallet, 'phoenix', () => this.phoenixPortfolio(wallet)),
      this.loadVenuePortfolio(wallet, 'gmtrade', () => this.gmtradeState.portfolio(wallet)),
    ]);
    return { wallet, ...balances, venues: { phoenix, gmtrade }, fetchedAt: Date.now() };
  }

  private async loadWalletBalances(wallet: string): Promise<WalletBalanceState> {
    try {
      const response = await this.tokens.balances(wallet);
      const sol = response.balances.find((item) => item.token.mint === SOL_MINT)?.amountAtomic ?? '0';
      const usdc = response.balances.find((item) => item.token.mint === USDC_MINT)?.amountAtomic ?? '0';
      const at = Date.now();
      this.walletBalanceCache.set(wallet, { at, sol, usdc });
      while (this.walletBalanceCache.size > 500) this.walletBalanceCache.delete(this.walletBalanceCache.keys().next().value!);
      return {
        walletSolLamports: sol,
        walletUsdcAtomic: usdc,
        walletBalancesStale: false,
        walletBalancesFetchedAt: at,
        walletBalancesError: null,
      };
    } catch (error) {
      const cached = this.walletBalanceCache.get(wallet);
      const usable = cached && Date.now() - cached.at <= WALLET_BALANCE_FALLBACK_MS ? cached : null;
      return {
        walletSolLamports: usable?.sol ?? null,
        walletUsdcAtomic: usable?.usdc ?? null,
        walletBalancesStale: Boolean(usable),
        walletBalancesFetchedAt: usable?.at ?? null,
        walletBalancesError: usable
          ? 'The Solana RPC refresh failed. Showing the last verified wallet balances.'
          : error instanceof Error ? error.message : 'Wallet balances are unavailable from the Solana RPC.',
      };
    }
  }

  invalidateWalletState(wallet: string, venue?: FuturesVenue): void {
    if (!venue || venue === 'phoenix') {
      this.portfolioCache.delete(`${wallet}:phoenix`);
      this.phoenix.invalidateWalletState(wallet);
    }
    if (!venue || venue === 'gmtrade') this.portfolioCache.delete(`${wallet}:gmtrade`);
  }

  private async loadVenuePortfolio(wallet: string, venue: FuturesVenue, load: () => Promise<FuturesVenuePortfolio>): Promise<FuturesVenuePortfolio> {
    const key = `${wallet}:${venue}`;
    try {
      const value = await load();
      if (value.available) this.portfolioCache.set(key, { at: Date.now(), value: structuredClone(value) });
      while (this.portfolioCache.size > 500) this.portfolioCache.delete(this.portfolioCache.keys().next().value!);
      return value;
    } catch (error) {
      const cached = this.portfolioCache.get(key);
      const fallback = cached && Date.now() - cached.at <= 30 * 60_000 ? structuredClone(cached.value) : undefined;
      return failedPortfolio(venue, error, fallback);
    }
  }

  async diagnostics(): Promise<FuturesDiagnostics> {
    if (this.diagnosticsCache && Date.now() - this.diagnosticsCache.at < 5_000) return this.diagnosticsCache.value;
    const [phoenixPublic, gmtrade, candleResult, rpcResult] = await Promise.all([
      this.phoenix.readiness(),
      this.gmtrade.readiness(),
      this.candles('SOL-PERP', '1m').then((value) => ({ ok: true as const, value })).catch((error: unknown) => ({ ok: false as const, error })),
      withRpcFallback(async (rpc) => {
        const latest = await rpc.getLatestBlockhash('confirmed');
        const transaction = new VersionedTransaction(new TransactionMessage({
          payerKey: Keypair.generate().publicKey,
          recentBlockhash: latest.blockhash,
          instructions: [],
        }).compileToV0Message());
        const simulation = await rpc.simulateTransaction(transaction, { sigVerify: false, commitment: 'confirmed' });
        return { slot: simulation.context.slot };
      }).then((value) => ({ ok: true as const, value })).catch((error: unknown) => ({ ok: false as const, error })),
    ]);
    const latestCandleAt = candleResult.ok ? candleResult.value.latestCandleAt : null;
    const value: FuturesDiagnostics = {
      checkedAt: Date.now(),
      phoenixPublic,
      gmtrade,
      candles: {
        available: candleResult.ok && candleResult.value.candles.length > 0,
        fresh: latestCandleAt !== null && Math.abs(Date.now() - latestCandleAt) <= 120_000,
        latestCandleAt,
        detail: candleResult.ok ? candleResult.value.source : candleResult.error instanceof Error ? candleResult.error.message : 'Phoenix candles are unavailable.',
      },
      rpc: { available: rpcResult.ok, detail: rpcResult.ok ? 'Latest blockhash is available.' : rpcResult.error instanceof Error ? rpcResult.error.message : 'Solana RPC is unavailable.' },
      simulation: { available: rpcResult.ok && rpcResult.value.slot > 0, detail: rpcResult.ok ? 'The configured RPC accepted a current v0 simulation probe.' : 'The configured RPC simulation endpoint is unavailable.' },
      gmtradeProcess: this.gmtrade.diagnostics(),
      phoenixStream: this.phoenix.diagnostics(),
    };
    this.diagnosticsCache = { at: Date.now(), value };
    return value;
  }

  private async phoenixPortfolio(wallet: string): Promise<FuturesVenuePortfolio> {
    const access = await this.phoenix.access(wallet);
    if (!access.publicData) throw new Error(access.message);
    if (!access.traderRegistered) {
      return {
        venue: 'phoenix', available: true, collateralAtomic: '0', withdrawableAtomic: '0',
        positions: [], orders: [], orphanedConditionals: [], history: [], error: null, fetchedAt: Date.now(),
      };
    }
    let response: Awaited<ReturnType<PhoenixAdapter['traderState']>>;
    try {
      response = await this.phoenix.traderState(wallet);
    } catch (error) {
      if (!isPhoenixTraderNotFound(error)) throw error;
      return {
        venue: 'phoenix', available: true, collateralAtomic: '0', withdrawableAtomic: '0',
        positions: [], orders: [], orphanedConditionals: [], history: [], error: null, fetchedAt: Date.now(),
      };
    }
    const symbols = [...new Set(response.snapshot.subaccounts.flatMap((account) => [
      ...account.positions.map((position) => position.symbol),
      ...account.orders.map((orders) => orders.symbol),
    ]))];
    const [marketConfigs, normalizedMarkets, tradeHistory, orderHistory, collateralHistory] = await Promise.all([
      Promise.all(symbols.map(async (symbol) => {
        try { return [symbol, await this.phoenix.marketConfig(symbol)] as const; } catch { return null; }
      })).then((rows) => rows.filter((row): row is readonly [string, NonNullable<typeof row>[1]] => row !== null)),
      this.phoenix.markets().catch(() => []),
      this.phoenix.tradeHistory(wallet).catch(() => ({ data: [] })),
      this.phoenix.orderHistory(wallet).catch(() => ({ data: [] })),
      this.phoenix.collateralHistory(wallet).catch(() => ({ data: [] })),
    ]);
    const configs = new Map(marketConfigs);
    const marketRows = new Map(normalizedMarkets.map((market) => [market.nativeSymbol, market]));
    const views = new Map<number, Awaited<ReturnType<PhoenixAdapter['traderView']>>>();
    await Promise.all(response.snapshot.subaccounts.map(async (account) => {
      try {
        views.set(account.subaccountIndex, await this.phoenix.traderView(wallet, response.traderPdaIndex, account.subaccountIndex));
      } catch {
        // The snapshot remains the exact fallback while a just-created PDA is indexing.
      }
    }));

    const positionRows = response.snapshot.subaccounts.flatMap((account) => account.positions.map((position) => {
      const signedSize = BigInt(position.basePositionLots);
      const side = signedSize >= 0n ? 'long' as const : 'short' as const;
      const sizeAtomic = (signedSize >= 0n ? signedSize : -signedSize).toString();
      const config = configs.get(position.symbol);
      const venueMarket = marketRows.get(position.symbol);
      const view = views.get(account.subaccountIndex)?.positions.find((item) => item.symbol === position.symbol);
      const tickPrice = (ticks: string): string => {
        if (!config) return '0';
        return decimalStringToAtomic(String(ticksToUsdWithMarketParams(ticks, {
          tickSize: config.tickSize,
          baseLotsDecimals: config.baseLotsDecimals,
        })), 6);
      };
      const directionFor = (kind: 'take-profit' | 'stop-loss') => (
        (kind === 'take-profit') === (side === 'long') ? 'greater_than' : 'less_than'
      );
      const conditionalRows = [
        ...position.conditionalTakeProfitTriggers.map((item) => ({ item, kind: 'take-profit' as const })),
        ...position.conditionalStopLossTriggers.map((item) => ({ item, kind: 'stop-loss' as const })),
      ];
      const conditionals = conditionalRows.map(({ item, kind }) => {
        const providerId = kind === 'take-profit' ? item.conditionalTakeProfitId : item.conditionalStopLossId;
        const direction = directionFor(kind);
        return {
          venue: 'phoenix' as const,
          nativeId: `${response.traderPdaIndex}:${account.subaccountIndex}:${position.symbol}:${side}:${kind}:${direction}:${providerId}`,
          kind,
          triggerPriceMicroUsd: tickPrice(item.trigger.triggerPriceTicks),
          executionPriceMicroUsd: tickPrice(item.trigger.executionPriceTicks),
          sizeAtomic: item.trigger.maxSizeLots,
          orphaned: BigInt(item.trigger.maxSizeLots) > 0n && BigInt(item.trigger.fillableSizeLots) === 0n,
          status: item.status,
        };
      });
      const leverageBps = view && view.positionInitialMargin.value > 0
        ? Math.round(view.positionValue.value / view.positionInitialMargin.value * 10_000)
        : null;
      return {
        venue: 'phoenix' as const,
        nativeId: `${response.traderPdaIndex}:${account.subaccountIndex}:${position.symbol}:${side}`,
        market: `${position.symbol}-PERP`, side, sizeAtomic,
        baseDecimals: config?.baseLotsDecimals ?? 0,
        collateralAtomic: phoenixCollateralAtomic(account.collateral),
        entryPriceMicroUsd: priceToMicro(position.entryPriceUsd),
        markPriceMicroUsd: venueMarket?.markPriceMicroUsd ?? '0',
        liquidationPriceMicroUsd: view ? decimalStringToAtomic(view.liquidationPrice.ui, 6) : null,
        unrealizedPnlMicroUsd: view ? decimalStringToAtomic(view.unrealizedPnl.ui, 6) : '0',
        leverageBps,
        conditionals,
        updatedAt: Date.now(),
      };
    }));

    const orders = response.snapshot.subaccounts.flatMap((account) => account.orders.flatMap((marketOrders) => {
      const config = configs.get(marketOrders.symbol);
      return marketOrders.orders.map((order) => {
        const orderSide = order.side === 'bid' ? 'long' as const : 'short' as const;
        return {
          venue: 'phoenix' as const,
          nativeId: `${response.traderPdaIndex}:${account.subaccountIndex}:${marketOrders.symbol}:${orderSide}:${order.priceTicks}:${order.orderSequenceNumber}`,
          market: `${marketOrders.symbol}-PERP`, side: orderSide, orderType: 'limit' as const,
          sizeAtomic: order.initialSizeLots, remainingSizeAtomic: order.sizeRemainingLots,
          baseDecimals: config?.baseLotsDecimals ?? 0,
          limitPriceMicroUsd: priceToMicro(order.priceUsd), reduceOnly: order.reduceOnly, status: order.status,
          createdAt: null, updatedAt: Date.now(),
        };
      });
    }));

    const collateral = response.snapshot.subaccounts.reduce((total, account) => total + BigInt(phoenixCollateralAtomic(account.collateral)), 0n);
    const withdrawable = phoenixParentWithdrawableAtomic(views);
    const timestampMs = (value: number) => value < 10_000_000_000 ? value * 1_000 : value;
    const history = [
      ...tradeHistory.data.map((trade) => ({
        venue: 'phoenix' as const,
        nativeId: trade.fillId ?? `${trade.slot}:${trade.eventIndex}`,
        market: `${trade.marketSymbol}-PERP`, kind: trade.tradeType, status: 'filled',
        sizeAtomic: trade.baseLotsDelta.replace(/^-/, ''), priceMicroUsd: priceToMicro(trade.price),
        signature: trade.signature, occurredAt: timestampMs(trade.timestamp),
      })),
      ...orderHistory.data.map((order) => ({
        venue: 'phoenix' as const,
        nativeId: order.orderSequenceNumber,
        market: `${order.marketSymbol}-PERP`, kind: order.isReduceOnly ? 'reduce-limit' : 'limit', status: order.status,
        sizeAtomic: order.baseQty, priceMicroUsd: priceToMicro(order.price), signature: null,
        occurredAt: timestampMs(order.completedAt ?? order.placedAt ?? 0),
      })),
      ...collateralHistory.data.map((event) => ({
        venue: 'phoenix' as const,
        nativeId: `${event.slot}:${event.eventIndex}`,
        market: 'USDC', kind: event.eventType, status: 'confirmed',
        sizeAtomic: decimalStringToAtomic(String(Math.abs(event.amount)), 6), priceMicroUsd: null, signature: null,
        occurredAt: timestampMs(event.timestamp),
      })),
    ].sort((left, right) => right.occurredAt - left.occurredAt);
    const orphanedConditionals = positionRows.flatMap((position) => position.conditionals
      .filter((conditional) => conditional.orphaned)
      .map((conditional) => ({ ...conditional, market: position.market })));
    return {
      venue: 'phoenix', available: !this.phoenix.traderStateStatus(wallet).stale,
      collateralAtomic: collateral.toString(), withdrawableAtomic: withdrawable,
      positions: positionRows, orders, orphanedConditionals, history,
      error: this.phoenix.traderStateStatus(wallet).stale
        ? 'Phoenix state refresh is rate-limited. Showing a recent authoritative snapshot.'
        : null,
      fetchedAt: this.phoenix.traderStateStatus(wallet).fetchedAt ?? Date.now(),
    };
  }
}

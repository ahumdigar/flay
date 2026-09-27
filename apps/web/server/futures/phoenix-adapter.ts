import {
  createPhoenixClient,
  getReferralActivationTraderState,
  PhoenixHttpClient,
  PhoenixHttpError,
  referralActivationExchangeAccountsFromSnapshot,
  type ExchangeMarketConfig,
  type PhoenixClient,
} from '@ellipsis-labs/rise';
import { randomUUID } from 'node:crypto';
import type {
  CandleInterval,
  FuturesCandlesResponse,
  FuturesIntent,
  FuturesRouteQuote,
  FuturesVenueMarket,
  PhoenixAccess,
} from '../../shared/futures.js';
import {
  FUTURES_DATA_STALE_MS,
  FUTURES_QUOTE_TTL_MS,
  baseSizeForNotional,
  decimalToMicroUsd,
  excludedQuote,
  liquidationEstimate,
  notionalForIntent,
  type VenueAdapter,
} from './domain.js';
import { config } from '../config.js';

const LAUNCH_SYMBOLS = new Set(['SOL', 'BTC', 'ETH']);
const ONBOARDING_URL = 'https://docs.phoenix.trade/sdk/register';
const TRADER_NOT_FOUND_ERROR = 'Trader not found for provided authority and trader_pda_index';

export function isPhoenixTraderNotFound(error: unknown): boolean {
  return error instanceof PhoenixHttpError
    && error.status === 404
    && (error.code === TRADER_NOT_FOUND_ERROR || error.body?.error === TRADER_NOT_FOUND_ERROR);
}

interface PhoenixCache {
  at: number;
  markets: FuturesVenueMarket[];
}

interface CandleCache {
  at: number;
  value: FuturesCandlesResponse;
}

interface LiveMark {
  at: number;
  price: number;
  slot: bigint;
  slotIndex: number;
}

interface LiveBook {
  at: number;
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
  slot: bigint;
}

type PhoenixTraderState = Awaited<ReturnType<ReturnType<PhoenixHttpClient['traders']>['getTraderStateSnapshot']>>;

interface CachedState<T> {
  at: number;
  value: T;
  retryAfter: number;
  lastErrorAt: number | null;
}

export interface PhoenixStateStatus {
  stale: boolean;
  fetchedAt: number | null;
  lastErrorAt: number | null;
}

export class PhoenixStateCache<T> {
  private readonly records = new Map<string, CachedState<T>>();
  private readonly inFlight = new Map<string, { generation: number; promise: Promise<{ value: T; stale: boolean }> }>();
  private readonly generations = new Map<string, number>();

  constructor(
    private readonly freshMs: number,
    private readonly staleFallbackMs: number,
    private readonly retryDelayMs: number,
    private readonly clock: () => number = Date.now,
    private readonly maxSize = 500,
  ) {}

  async get(key: string, load: () => Promise<T>): Promise<{ value: T; stale: boolean }> {
    const now = this.clock();
    const cached = this.records.get(key);
    if (cached && now - cached.at <= this.freshMs && cached.lastErrorAt === null) {
      return { value: cached.value, stale: false };
    }
    if (cached && now < cached.retryAfter && now - cached.at <= this.staleFallbackMs) {
      return { value: cached.value, stale: true };
    }
    const generation = this.generations.get(key) ?? 0;
    const pending = this.inFlight.get(key);
    if (pending?.generation === generation) return pending.promise;
    const request = load().then((value) => {
      if ((this.generations.get(key) ?? 0) === generation) {
        this.records.set(key, { at: this.clock(), value, retryAfter: 0, lastErrorAt: null });
        while (this.records.size > this.maxSize) this.records.delete(this.records.keys().next().value!);
      }
      return { value, stale: false };
    }).catch((error: unknown) => {
      const fallback = this.records.get(key);
      const failedAt = this.clock();
      if (fallback && failedAt - fallback.at <= this.staleFallbackMs) {
        fallback.retryAfter = failedAt + this.retryDelayMs;
        fallback.lastErrorAt = failedAt;
        return { value: fallback.value, stale: true };
      }
      throw error;
    }).finally(() => {
      if (this.inFlight.get(key)?.promise === request) this.inFlight.delete(key);
    });
    this.inFlight.set(key, { generation, promise: request });
    return request;
  }

  status(key: string): PhoenixStateStatus {
    const cached = this.records.get(key);
    if (!cached) return { stale: false, fetchedAt: null, lastErrorAt: null };
    return {
      stale: cached.lastErrorAt !== null && this.clock() - cached.at > this.freshMs,
      fetchedAt: cached.at,
      lastErrorAt: cached.lastErrorAt,
    };
  }

  invalidate(key: string): void {
    this.records.delete(key);
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
  }
}

export interface PhoenixEntryReadiness {
  executionEligible: boolean;
  setupSteps: Array<'activate' | 'register' | 'deposit'>;
  exclusionCode: string | null;
  exclusionReason: string | null;
}

export function phoenixEntryReadiness(
  access: PhoenixAccess,
  parentCollateralAtomic: string | null,
  requestedCollateralAtomic: string,
): PhoenixEntryReadiness {
  if (!access.executionEligible) {
    const setupSteps: PhoenixEntryReadiness['setupSteps'] = [];
    if (!access.activated) setupSteps.push('activate');
    if (access.activated && !access.traderRegistered) setupSteps.push('register');
    return {
      executionEligible: false,
      setupSteps,
      exclusionCode: 'PHOENIX_ONBOARDING_REQUIRED',
      exclusionReason: access.message,
    };
  }
  if (!access.traderRegistered) {
    return {
      executionEligible: false,
      setupSteps: ['register'],
      exclusionCode: 'PHOENIX_REGISTRATION_REQUIRED',
      exclusionReason: 'Register the Phoenix trader account, then refresh routes.',
    };
  }
  if (parentCollateralAtomic === null) {
    return {
      executionEligible: false,
      setupSteps: [],
      exclusionCode: 'PHOENIX_STATE_UNAVAILABLE',
      exclusionReason: 'Phoenix collateral state is unavailable. Refresh routes before entry.',
    };
  }
  if (BigInt(parentCollateralAtomic) < BigInt(requestedCollateralAtomic)) {
    return {
      executionEligible: false,
      setupSteps: ['deposit'],
      exclusionCode: 'PHOENIX_COLLATERAL_REQUIRED',
      exclusionReason: 'Deposit enough USDC to Phoenix, then refresh routes.',
    };
  }
  return { executionEligible: true, setupSteps: [], exclusionCode: null, exclusionReason: null };
}

export function phoenixQuoteBookIsStale(quotedAt: number, bookFetchedAt: number): boolean {
  return quotedAt - bookFetchedAt > FUTURES_DATA_STALE_MS;
}

export class PhoenixAdapter implements VenueAdapter {
  readonly venue = 'phoenix' as const;
  private readonly client: PhoenixHttpClient;
  private readonly live: PhoenixClient;
  private cache: PhoenixCache | null = null;
  private inFlightMarkets: Promise<FuturesVenueMarket[]> | null = null;
  private readonly candleCache = new Map<string, CandleCache>();
  private readonly inFlightCandles = new Map<string, Promise<FuturesCandlesResponse>>();
  private readonly liveMarks = new Map<string, LiveMark>();
  private readonly liveBooks = new Map<string, LiveBook>();
  private readonly markStreams = new Set<string>();
  private readonly bookStreams = new Set<string>();
  private readonly accessCache = new Map<string, { at: number; value: PhoenixAccess }>();
  private readonly accessInFlight = new Map<string, Promise<PhoenixAccess>>();
  private readonly accessRetryAfter = new Map<string, number>();
  private readonly traderStates = new PhoenixStateCache<PhoenixTraderState>(15_000, 60_000, 5_000);
  private liveStarted = false;
  private readonly liveMetrics = { updates: 0, reconnects: 0, sequenceRepairs: 0, lastUpdateAt: null as number | null, lastErrorAt: null as number | null };
  private readonly providerMetrics = { requests: 0, failures: 0, staleResults: 0, lastLatencyMs: 0, lastFailureAt: null as number | null };

  private async observe<T>(operation: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    this.providerMetrics.requests += 1;
    try {
      return await operation();
    } catch (error) {
      this.providerMetrics.failures += 1;
      this.providerMetrics.lastFailureAt = Date.now();
      throw error;
    } finally {
      this.providerMetrics.lastLatencyMs = Date.now() - startedAt;
    }
  }

  constructor() {
    const options = { timeout: 8_000, rateLimitRetry: { maxRetries: 1, maxTotalWaitMs: 1_000 } };
    this.client = new PhoenixHttpClient(options);
    this.live = createPhoenixClient({
      ...options,
      rpcUrl: process.env.SOLANA_RPC_URL,
      ws: { connectMode: 'lazy', idleCloseMs: 60_000, backoff: { baseMs: 500, maxMs: 8_000 } },
      exchangeMetadata: {
        stream: true,
        rpc: { enabled: false },
        onBackgroundError: () => { this.liveMetrics.lastErrorAt = Date.now(); },
      },
    });
  }

  private ensureLiveStarted() {
    if (this.liveStarted) return;
    this.liveStarted = true;
    this.live.exchange.subscribe((event) => {
      if (event.type === 'healthChanged') {
        if (event.current === 'recovering') this.liveMetrics.sequenceRepairs += 1;
        if (event.previous === 'recovering' && event.current === 'live') this.liveMetrics.reconnects += 1;
      }
      if (event.type === 'marketAdded' || event.type === 'marketRemoved' || event.type === 'snapshotApplied') {
        this.cache = null;
      }
    });
    void this.live.exchange.ready().catch(() => { this.liveMetrics.lastErrorAt = Date.now(); });
    for (const symbol of LAUNCH_SYMBOLS) this.ensureMarkStream(symbol);
  }

  private ensureMarkStream(symbol: string) {
    if (this.markStreams.has(symbol) || !this.live.streams) return;
    this.markStreams.add(symbol);
    void (async () => {
      try {
        for await (const update of this.live.streams!.markPrice(symbol)) {
          const previous = this.liveMarks.get(symbol);
          if (previous && (update.slot < previous.slot || (update.slot === previous.slot && update.slotIndex <= previous.slotIndex))) continue;
          this.liveMarks.set(symbol, { at: Date.now(), price: update.markPrice, slot: update.slot, slotIndex: update.slotIndex });
          this.liveMetrics.updates += 1;
          this.liveMetrics.lastUpdateAt = Date.now();
        }
      } catch {
        this.liveMetrics.lastErrorAt = Date.now();
      } finally {
        this.markStreams.delete(symbol);
      }
    })();
  }

  private ensureBookStream(symbol: string) {
    if (this.bookStreams.has(symbol) || !this.live.streams) return;
    this.bookStreams.add(symbol);
    void (async () => {
      try {
        for await (const update of this.live.streams!.l2Book(symbol)) {
          const previous = this.liveBooks.get(symbol);
          if (previous && update.slot <= previous.slot) continue;
          this.liveBooks.set(symbol, { at: Date.now(), bids: update.bids, asks: update.asks, slot: update.slot });
          this.liveMetrics.updates += 1;
          this.liveMetrics.lastUpdateAt = Date.now();
        }
      } catch {
        this.liveMetrics.lastErrorAt = Date.now();
      } finally {
        this.bookStreams.delete(symbol);
        this.liveBooks.delete(symbol);
      }
    })();
  }

  diagnostics() {
    return { ...this.liveMetrics, provider: { ...this.providerMetrics }, health: this.live.exchange.health(), source: this.live.exchange.source().active };
  }

  close() {
    this.live.dispose();
  }

  async readiness(wallet?: string) {
    try {
      const status = await this.client.exchange().getStatus();
      if (!status.active) return { publicData: true, execution: false, status: 'degraded' as const, detail: 'Phoenix exchange is paused.', checkedAt: Date.now() };
      if (!wallet) return { publicData: true, execution: false, status: 'onboarding-required' as const, detail: 'Wallet onboarding is required for Phoenix execution.', checkedAt: Date.now() };
      const access = await this.access(wallet);
      return {
        publicData: true,
        execution: access.executionEligible,
        status: access.executionEligible ? 'ready' as const : 'onboarding-required' as const,
        detail: access.message,
        checkedAt: access.checkedAt,
      };
    } catch {
      return { publicData: false, execution: false, status: 'unavailable' as const, detail: 'Phoenix public API is unavailable.', checkedAt: Date.now() };
    }
  }

  async access(wallet: string): Promise<PhoenixAccess> {
    const cached = this.accessCache.get(wallet);
    const now = Date.now();
    const cacheTtl = cached?.value.stale ? 5_000 : cached?.value.publicData ? 60_000 : 3_000;
    if (cached && now - cached.at < cacheTtl) return cached.value;
    if (cached?.value.publicData && now < (this.accessRetryAfter.get(wallet) ?? 0) && now - cached.at <= 5 * 60_000) {
      return { ...cached.value, stale: true, message: 'Phoenix access refresh is recovering; using the last verified wallet access state.' };
    }
    const pending = this.accessInFlight.get(wallet);
    if (pending) return pending;
    const load = this.loadAccess(wallet);
    this.accessInFlight.set(wallet, load);
    try {
      const value = await load;
      if (!value.publicData && cached?.value.publicData && Date.now() - cached.at <= 5 * 60_000) {
        this.accessRetryAfter.set(wallet, Date.now() + 5_000);
        return { ...cached.value, stale: true, message: 'Phoenix access refresh is recovering; using the last verified wallet access state.' };
      }
      this.accessRetryAfter.delete(wallet);
      this.accessCache.set(wallet, { at: Date.now(), value });
      while (this.accessCache.size > 500) this.accessCache.delete(this.accessCache.keys().next().value!);
      return value;
    } finally {
      this.accessInFlight.delete(wallet);
    }
  }

  private async loadAccess(wallet: string): Promise<PhoenixAccess> {
    try {
      const trader = await this.traderState(wallet);
      const capabilities = trader.snapshot.capabilities.capabilities;
      const executable = capabilities.placeMarketOrder.immediate && capabilities.riskIncreasingTrade.immediate;
      const stale = this.traderStateStatus(wallet).stale;
      return {
        wallet, publicData: true, activated: executable, traderRegistered: true,
        executionEligible: executable,
        status: executable ? 'active' : 'registration-required',
        message: stale
          ? 'Phoenix access refresh is recovering; using the last verified trader state.'
          : executable ? 'Phoenix execution is active.' : 'The Phoenix trader account exists but still needs public onboarding.',
        onboardingUrl: ONBOARDING_URL, checkedAt: Date.now(), stale,
      };
    } catch (error) {
      if (!isPhoenixTraderNotFound(error)) {
        // The referral-state RPC remains a bounded fallback when the trader API is unavailable.
      }
    }
    try {
      const snapshot = await this.client.exchange().getSnapshot();
      const exchangeAccounts = await referralActivationExchangeAccountsFromSnapshot(snapshot.exchange);
      const trader = await getReferralActivationTraderState({
        traderAuthority: wallet,
        exchangeAccounts,
        traderPdaIndex: 0,
        traderSubaccountIndex: 0,
        rpcUrl: config.rpcUrl,
      });
      const traderRegistered = trader.status !== 'missing';
      const activated = trader.status === 'activated';
      const executable = activated;
      return {
        wallet, publicData: true, activated, traderRegistered,
        executionEligible: executable,
        status: executable ? 'active' : traderRegistered ? 'registration-required' : 'onboarding-required',
        message: executable ? 'Phoenix execution is active.' : traderRegistered
          ? 'The Phoenix trader account exists but still needs public onboarding.'
          : 'Phoenix public onboarding is required.',
        onboardingUrl: ONBOARDING_URL, checkedAt: Date.now(), stale: false,
      };
    } catch {
      return { wallet, publicData: false, activated: false, traderRegistered: false, executionEligible: false, status: 'unavailable', message: 'Phoenix onboarding state is unavailable.', onboardingUrl: ONBOARDING_URL, checkedAt: Date.now() };
    }
  }

  async traderState(wallet: string): Promise<PhoenixTraderState> {
    const result = await this.traderStates.get(wallet, () => this.observe(
      () => this.client.traders().getTraderStateSnapshot(wallet, { traderPdaIndex: 0 }),
    ));
    if (result.stale) this.providerMetrics.staleResults += 1;
    return result.value;
  }

  traderStateStatus(wallet: string): PhoenixStateStatus {
    return this.traderStates.status(wallet);
  }

  invalidateWalletState(wallet: string): void {
    this.traderStates.invalidate(wallet);
    this.accessCache.delete(wallet);
    this.accessRetryAfter.delete(wallet);
  }


  marketConfig(symbol: string) {
    return this.client.exchange().getMarket(symbol);
  }

  async traderView(wallet: string, traderPdaIndex: number, subaccountIndex: number) {
    const trader = await this.client.pda.getTraderAddress({
      authority: wallet as never,
      traderPdaIndex,
      subaccountIndex,
    });
    return this.client.traders().getTrader(trader);
  }

  tradeHistory(wallet: string) {
    return this.client.trades().getTraderTradesHistory(wallet, { pdaIndex: 0, limit: 100 });
  }

  orderHistory(wallet: string) {
    return this.client.orders().getTraderOrderHistory(wallet, { traderPdaIndex: 0, limit: 100 });
  }

  collateralHistory(wallet: string) {
    return this.client.collateral().getTraderCollateralHistory(wallet, { pdaIndex: 0, limit: 100 });
  }

  async markets(): Promise<FuturesVenueMarket[]> {
    this.ensureLiveStarted();
    if (this.cache && Date.now() - this.cache.at < 10_000) return this.withLiveMarks(this.cache.markets);
    if (this.inFlightMarkets) return this.inFlightMarkets;
    this.inFlightMarkets = this.observe(() => this.loadMarkets());
    try { return this.withLiveMarks(await this.inFlightMarkets); } finally { this.inFlightMarkets = null; }
  }

  private withLiveMarks(markets: FuturesVenueMarket[]): FuturesVenueMarket[] {
    const now = Date.now();
    return markets.map((market) => {
      const live = this.liveMarks.get(market.nativeSymbol);
      if (!live || now - live.at > FUTURES_DATA_STALE_MS) return market;
      return {
        ...market,
        markPriceMicroUsd: decimalToMicroUsd(live.price),
        sourceSlot: String(live.slot),
        fetchedAt: live.at,
      };
    });
  }

  private async loadMarkets(): Promise<FuturesVenueMarket[]> {
    const [markets, stats] = await Promise.all([
      this.client.markets().getMarkets(),
      this.client.markets().getLatestMarketsStats(),
    ]);
    const statsBySymbol = new Map(stats.markets.map((item) => [item.symbol, item]));
    const now = Date.now();
    const normalized = markets.filter((market) => LAUNCH_SYMBOLS.has(market.symbol)).map((market) => this.normalizeMarket(market, statsBySymbol.get(market.symbol), now));
    this.cache = { at: now, markets: normalized };
    return normalized;
  }

  private normalizeMarket(market: ExchangeMarketConfig, stats: Awaited<ReturnType<ReturnType<PhoenixHttpClient['markets']>['getLatestMarketsStats']>>['markets'][number] | undefined, fetchedAt: number): FuturesVenueMarket {
    const liveMark = this.liveMarks.get(market.symbol);
    const usableLiveMark = liveMark && fetchedAt - liveMark.at <= FUTURES_DATA_STALE_MS ? liveMark : null;
    const mark = usableLiveMark?.price ?? stats?.mark_price ?? null;
    return {
      venue: 'phoenix', nativeSymbol: market.symbol, marketAddress: market.marketPubkey,
      baseDecimals: market.baseLotsDecimals, priceDecimals: 6,
      maximumLeverageBps: Math.min(100_000, Math.round((market.leverageTiers[0]?.maxLeverage ?? 1) * 10_000)),
      active: market.marketStatus === 'active', markPriceMicroUsd: mark === null ? null : decimalToMicroUsd(mark),
      bidPriceMicroUsd: null, askPriceMicroUsd: null,
      fundingRateBpsHourly: stats ? String(Math.round(stats.current_funding_rate * 100)) : null,
      openingFeeBps: Math.round(market.takerFee * 10_000),
      sourceSlot: usableLiveMark ? String(usableLiveMark.slot) : market.statsSnapshot?.slot === undefined ? null : String(market.statsSnapshot.slot),
      fetchedAt, unavailableReason: market.marketStatus === 'active' ? null : `Phoenix market status is ${market.marketStatus}.`,
    };
  }

  async candles(symbol: string, interval: CandleInterval): Promise<FuturesCandlesResponse> {
    const key = `${symbol}:${interval}`;
    const cached = this.candleCache.get(key);
    if (cached && Date.now() - cached.at < 2_000) return cached.value;
    const pending = this.inFlightCandles.get(key);
    if (pending) return pending;
    const load = this.observe(() => this.loadCandles(symbol, interval));
    this.inFlightCandles.set(key, load);
    try {
      const value = await load;
      this.candleCache.set(key, { at: Date.now(), value });
      while (this.candleCache.size > 24) this.candleCache.delete(this.candleCache.keys().next().value!);
      return value;
    } finally {
      this.inFlightCandles.delete(key);
    }
  }

  private async loadCandles(symbol: string, interval: CandleInterval): Promise<FuturesCandlesResponse> {
    const rows = await this.client.candles().getCandles(symbol.replace('-PERP', ''), { timeframe: interval, limit: 500, enableExternalSource: true });
    const now = Date.now();
    const candles = rows.map((row) => ({
      time: row.time,
      openMicroUsd: decimalToMicroUsd(row.markOpen ?? row.open),
      highMicroUsd: decimalToMicroUsd(row.markHigh ?? row.high),
      lowMicroUsd: decimalToMicroUsd(row.markLow ?? row.low),
      closeMicroUsd: decimalToMicroUsd(row.markClose ?? row.close),
      volumeQuoteMicroUsd: row.volumeQuote === undefined ? null : decimalToMicroUsd(row.volumeQuote),
    }));
    return { symbol, interval, source: 'Phoenix external reference', candles, fetchedAt: now, latestCandleAt: candles.at(-1)?.time ?? null };
  }

  async quote(intent: FuturesIntent, market: FuturesVenueMarket): Promise<FuturesRouteQuote> {
    if (!market.active) return excludedQuote('phoenix', intent, market, 'MARKET_PAUSED', market.unavailableReason ?? 'Phoenix market is paused.');
    const access = await this.access(intent.wallet);
    let parentCollateralAtomic: string | null = null;
    if (access.executionEligible) {
      try {
        const trader = await this.traderState(intent.wallet);
        const parent = trader.snapshot.subaccounts.find((account) => account.subaccountIndex === 0);
        parentCollateralAtomic = parent ? BigInt(parent.collateral).toString() : null;
      } catch {
        parentCollateralAtomic = null;
      }
    }
    const entryReadiness = phoenixEntryReadiness(access, parentCollateralAtomic, intent.collateralAtomic);
    const stateStatus = this.traderStateStatus(intent.wallet);
    this.ensureLiveStarted();
    this.ensureBookStream(market.nativeSymbol);
    const streamedBook = this.liveBooks.get(market.nativeSymbol);
    const liveBookIsFresh = Boolean(streamedBook && Date.now() - streamedBook.at <= FUTURES_DATA_STALE_MS);
    const book = liveBookIsFresh
      ? { bids: streamedBook!.bids, asks: streamedBook!.asks, mid: null, slot: streamedBook!.slot }
      : await this.client.orderbook().getOrderbook(market.nativeSymbol);
    const bookFetchedAt = liveBookIsFresh ? streamedBook!.at : Date.now();
    const reference = book.mid ?? ((book.bids[0]?.[0] ?? 0) + (book.asks[0]?.[0] ?? 0)) / 2;
    if (!Number.isFinite(reference) || reference <= 0) return excludedQuote('phoenix', intent, market, 'PRICE_UNAVAILABLE', 'Phoenix has no current two-sided reference price.');
    const levels = intent.side === 'long' ? book.asks : book.bids;
    const notional = notionalForIntent(intent);
    const limitMicro = intent.limitPriceMicroUsd ? BigInt(intent.limitPriceMicroUsd) : null;
    let entryPrice = reference;
    let baseAtomic: bigint;
    let impactBps = 0;
    if (intent.orderType === 'limit') {
      entryPrice = Number(limitMicro!) / 1_000_000;
      baseAtomic = baseSizeForNotional(notional, limitMicro!, market.baseDecimals);
    } else {
      let remainingUsd = Number(notional) / 1_000_000;
      let totalBase = 0;
      let totalUsd = 0;
      for (const [price, availableBase] of levels) {
        const takeBase = Math.min(availableBase, remainingUsd / price);
        totalBase += takeBase;
        totalUsd += takeBase * price;
        remainingUsd -= takeBase * price;
        if (remainingUsd <= 0.000001) break;
      }
      if (remainingUsd > 0.000001 || totalBase <= 0) return excludedQuote('phoenix', intent, market, 'INSUFFICIENT_LIQUIDITY', 'Phoenix cannot fill this size inside its live orderbook.');
      entryPrice = totalUsd / totalBase;
      baseAtomic = BigInt(Math.floor(totalBase * 10 ** market.baseDecimals));
      impactBps = Math.round(Math.abs(entryPrice - reference) / reference * 10_000);
    }
    const entryMicro = BigInt(decimalToMicroUsd(entryPrice));
    const referenceMicro = BigInt(decimalToMicroUsd(reference));
    const openingFee = notional * BigInt(market.openingFeeBps ?? 0) / 10_000n;
    const adverse = notional * BigInt(impactBps) / 10_000n;
    const slippage = BigInt(intent.slippageBps);
    const acceptable = intent.side === 'long' ? entryMicro * (10_000n + slippage) / 10_000n : entryMicro * (10_000n - slippage) / 10_000n;
    const fetchedAt = Date.now();
    const stale = phoenixQuoteBookIsStale(fetchedAt, bookFetchedAt);
    if (stale) this.providerMetrics.staleResults += 1;
    const eligible = entryReadiness.executionEligible && !stale;
    return {
      id: randomUUID(), venue: 'phoenix', market: intent.market, nativeMarketAddress: market.marketAddress,
      side: intent.side, orderType: intent.orderType, collateralAtomic: intent.collateralAtomic,
      notionalMicroUsd: notional.toString(), baseSizeAtomic: baseAtomic.toString(), baseDecimals: market.baseDecimals,
      entryPriceMicroUsd: entryMicro.toString(), acceptablePriceMicroUsd: (intent.orderType === 'limit' ? limitMicro! : acceptable).toString(),
      liquidationPriceMicroUsd: liquidationEstimate(referenceMicro, intent.side, intent.leverageBps).toString(),
      openingFeeMicroUsd: openingFee.toString(), executionFeeLamports: null, networkFeeLamports: null,
      accountRentLamports: null, immediateCostMicroUsd: (openingFee + adverse).toString(), priceImpactBps: impactBps,
      fundingRateBpsHourly: market.fundingRateBpsHourly, borrowingRateBpsHourly: null,
      setupSteps: entryReadiness.setupSteps,
      executionEligible: eligible,
      exclusionCode: eligible ? null : stale ? 'STALE_DATA' : entryReadiness.exclusionCode,
      exclusionReason: eligible ? null : stale ? 'Phoenix market data is stale.' : entryReadiness.exclusionReason,
      dataWarning: eligible && (stateStatus.stale || access.stale)
        ? 'Using recent verified Phoenix collateral while its refresh recovers.'
        : null,
      sourceSlot: String(book.slot), fetchedAt, expiresAt: fetchedAt + FUTURES_QUOTE_TTL_MS,
    };
  }
}

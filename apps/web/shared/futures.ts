export type FuturesVenue = 'phoenix' | 'gmtrade';
export type FuturesOrderType = 'market' | 'limit';
export type FuturesSide = 'long' | 'short';
export type FuturesRouteChoice = 'auto' | FuturesVenue;
export type FuturesAction = 'activate' | 'register' | 'deposit' | 'open' | 'cancel' | 'close' | 'reduce' | 'take-profit' | 'stop-loss' | 'cancel-conditional' | 'withdraw';

export interface FuturesVenueMarket {
  venue: FuturesVenue;
  nativeSymbol: string;
  nativeMarketName?: string;
  marketAddress: string;
  marketTokenAddress?: string;
  baseDecimals: number;
  priceDecimals: number;
  maximumLeverageBps: number;
  active: boolean;
  markPriceMicroUsd: string | null;
  bidPriceMicroUsd: string | null;
  askPriceMicroUsd: string | null;
  fundingRateBpsHourly: string | null;
  openingFeeBps: number | null;
  sourceSlot: string | null;
  fetchedAt: number;
  unavailableReason: string | null;
}

export interface FuturesMarket {
  symbol: string;
  displayName: string;
  baseSymbol: string;
  quoteSymbol: 'USD';
  logoUri: string | null;
  baseDecimals: number;
  venues: Partial<Record<FuturesVenue, FuturesVenueMarket>>;
  activeVenues: FuturesVenue[];
  fetchedAt: number;
}

export interface FuturesMarketsResponse {
  markets: FuturesMarket[];
  venueReadiness: Record<FuturesVenue, VenueReadiness>;
  fetchedAt: number;
}

export interface VenueReadiness {
  publicData: boolean;
  execution: boolean;
  status: 'ready' | 'onboarding-required' | 'unavailable' | 'degraded';
  detail: string;
  checkedAt: number;
}

export type CandleInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export interface ReferenceCandle {
  time: number;
  openMicroUsd: string;
  highMicroUsd: string;
  lowMicroUsd: string;
  closeMicroUsd: string;
  volumeQuoteMicroUsd: string | null;
}

export interface FuturesCandlesResponse {
  symbol: string;
  interval: CandleInterval;
  source: string;
  candles: ReferenceCandle[];
  fetchedAt: number;
  latestCandleAt: number | null;
}

export interface FuturesIntent {
  wallet: string;
  market: string;
  side: FuturesSide;
  orderType: FuturesOrderType;
  collateralAtomic: string;
  leverageBps: number;
  limitPriceMicroUsd?: string;
  slippageBps: number;
  routeChoice: FuturesRouteChoice;
}

export interface FuturesRouteQuote {
  id: string;
  venue: FuturesVenue;
  market: string;
  nativeMarketAddress: string;
  nativeMarketTokenAddress?: string;
  side: FuturesSide;
  orderType: FuturesOrderType;
  collateralAtomic: string;
  notionalMicroUsd: string;
  baseSizeAtomic: string;
  baseDecimals: number;
  entryPriceMicroUsd: string | null;
  acceptablePriceMicroUsd: string | null;
  liquidationPriceMicroUsd: string | null;
  openingFeeMicroUsd: string | null;
  executionFeeLamports: string | null;
  networkFeeLamports: string | null;
  accountRentLamports: string | null;
  immediateCostMicroUsd: string | null;
  priceImpactBps: number | null;
  fundingRateBpsHourly: string | null;
  borrowingRateBpsHourly: string | null;
  setupSteps: FuturesAction[];
  executionEligible: boolean;
  exclusionCode: string | null;
  exclusionReason: string | null;
  dataWarning?: string | null;
  sourceSlot: string | null;
  fetchedAt: number;
  expiresAt: number;
}

export interface FuturesQuotesResponse {
  intent: FuturesIntent;
  quotes: FuturesRouteQuote[];
  recommendedVenue: FuturesVenue | null;
  recommendationLabel: 'Best route' | 'Only available route' | 'Choose a venue' | 'No route';
  warnings: string[];
  requestedAt: number;
}

export interface FuturesPosition {
  venue: FuturesVenue;
  nativeId: string;
  market: string;
  side: FuturesSide;
  sizeAtomic: string;
  baseDecimals: number;
  collateralAtomic: string;
  entryPriceMicroUsd: string;
  markPriceMicroUsd: string;
  liquidationPriceMicroUsd: string | null;
  unrealizedPnlMicroUsd: string;
  leverageBps: number | null;
  conditionals: FuturesConditional[];
  updatedAt: number;
}

export interface FuturesOrder {
  venue: FuturesVenue;
  nativeId: string;
  market: string;
  side: FuturesSide;
  orderType: FuturesOrderType;
  sizeAtomic: string;
  remainingSizeAtomic: string;
  baseDecimals: number;
  limitPriceMicroUsd: string | null;
  reduceOnly: boolean;
  status: string;
  createdAt: number | null;
  updatedAt: number;
}

export interface FuturesConditional {
  venue: FuturesVenue;
  nativeId: string;
  kind: 'take-profit' | 'stop-loss';
  triggerPriceMicroUsd: string;
  executionPriceMicroUsd: string;
  sizeAtomic: string;
  orphaned: boolean;
  status: string;
}

export interface FuturesOrphanedConditional extends FuturesConditional {
  market: string;
}

export interface FuturesHistoryItem {
  venue: FuturesVenue;
  nativeId: string;
  market: string;
  kind: string;
  status: string;
  sizeAtomic: string | null;
  priceMicroUsd: string | null;
  signature: string | null;
  occurredAt: number;
}

export interface FuturesVenuePortfolio {
  venue: FuturesVenue;
  available: boolean;
  collateralAtomic: string;
  withdrawableAtomic: string;
  positions: FuturesPosition[];
  orders: FuturesOrder[];
  orphanedConditionals: FuturesOrphanedConditional[];
  history: FuturesHistoryItem[];
  error: string | null;
  fetchedAt: number;
}

export interface FuturesPortfolio {
  wallet: string;
  walletSolLamports: string | null;
  walletUsdcAtomic: string | null;
  walletBalancesStale: boolean;
  walletBalancesFetchedAt: number | null;
  walletBalancesError: string | null;
  venues: Record<FuturesVenue, FuturesVenuePortfolio>;
  fetchedAt: number;
}

export interface PhoenixAccess {
  wallet: string;
  publicData: boolean;
  activated: boolean;
  traderRegistered: boolean;
  executionEligible: boolean;
  status: 'active' | 'onboarding-required' | 'registration-required' | 'unavailable';
  message: string;
  onboardingUrl: string;
  checkedAt: number;
  stale?: boolean;
}

export interface FuturesPrepareRequest {
  wallet: string;
  action: FuturesAction;
  venue: FuturesVenue;
  quoteId?: string;
  market?: string;
  nativeId?: string;
  sizeAtomic?: string;
  amountAtomic?: string;
  triggerPriceMicroUsd?: string;
  executionPriceMicroUsd?: string;
  idempotencyKey: string;
}

export interface FuturesPreparedStep {
  preparedId: string;
  action: FuturesAction;
  venue: FuturesVenue;
  wallet: string;
  transaction: string;
  messageHash: string;
  expiresAt: number;
  review: {
    market: string | null;
    nativeMarketAddress: string | null;
    side: FuturesSide | null;
    orderType: FuturesOrderType | null;
    collateralAtomic: string | null;
    sizeAtomic: string | null;
    priceMicroUsd: string | null;
    triggerPriceMicroUsd: string | null;
    executionPriceMicroUsd: string | null;
    executionFeeLamports: string | null;
    networkFeeLamports: string | null;
    accountRentLamports: string | null;
    lookupTables: string[];
    programs: string[];
    warnings: string[];
  };
}

export type FuturesExecutionStatus = 'submitted' | 'resting' | 'partial' | 'filled' | 'cancelled' | 'failed';

export interface FuturesExecution {
  executionId: string;
  preparedId: string;
  venue: FuturesVenue;
  action: FuturesAction;
  signature: string;
  status: FuturesExecutionStatus;
  explorerUrl: string;
  submittedAt: number;
  reconciledAt: number | null;
  detail: string;
}

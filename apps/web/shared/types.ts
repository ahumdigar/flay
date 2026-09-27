export type QuoteProvider = 'jupiter' | 'raydium' | 'orca';

export type TokenProgram = 'native' | 'spl-token' | 'token-2022';

export interface TokenInfo {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUri: string | null;
  tokenProgram: TokenProgram;
  verified: boolean;
  tags: string[];
  extensions: string[];
  tradable: boolean;
  blockedReason: string | null;
  usdPrice: number | null;
}

export interface BalanceItem {
  token: TokenInfo;
  amountAtomic: string;
  uiAmount: string;
}

export interface WalletBalances {
  wallet: string;
  slot: number;
  fetchedAt: number;
  balances: BalanceItem[];
}

export interface GaslessUsdcSendPrepared {
  preparedId: string;
  wallet: string;
  recipient: string;
  recipientAta: string;
  mint: typeof import('./constants.js').USDC_MINT;
  symbol: 'USDC';
  decimals: 6;
  amountAtomic: string;
  amountUi: string;
  transaction: string;
  messageHash: string;
  expiresAt: number;
  gasPayment: {
    mode: 'provider-sponsored';
    provider: 'Privy';
    detail: string;
  };
  review: {
    flayFeePercent: '0';
    recipientAccountExists: true;
    warnings: string[];
  };
}

export interface RecentGaslessUsdcSend {
  signature: string;
  wallet: string;
  recipient: string;
  amountAtomic: string;
  createdAt: number;
  status: ActivityRecord['status'];
}

export interface GaslessUsdcSendStatus {
  signature: string;
  status: ActivityRecord['status'];
  explorerUrl: string;
  feePayer: string | null;
  networkFeeLamports: string | null;
  senderNetworkFeeLamports: '0' | null;
  error: string | null;
}

export interface QuoteFee {
  label: string;
  amountAtomic: string | null;
  mint: string | null;
  detail: string;
}

export interface MarketQuote {
  id: string;
  provider: QuoteProvider;
  providerLabel: string;
  routeLabel: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  minimumOut: string;
  slippageBps: number;
  priceImpactPct: number | null;
  fees: QuoteFee[];
  networkFeeLamports: string | null;
  fetchedAt: number;
  expiresAt: number;
  poolIds: string[];
  warnings: string[];
}

export interface ProviderFailure {
  provider: QuoteProvider;
  message: string;
  code: string;
  retryable: boolean;
}

export interface QuoteResponse {
  inputToken: TokenInfo;
  outputToken: TokenInfo;
  quotes: MarketQuote[];
  failures: ProviderFailure[];
  bestQuoteId: string | null;
  requestedAt: number;
}

export type StockTradeSide = 'buy' | 'sell';

export interface StockMultiplierSnapshot {
  value: string;
  fetchedAt: number;
  nextValue: string | null;
  nextActivationAt: number | null;
  reason: string | null;
}

export interface StockAsset {
  symbol: string;
  underlyingSymbol: string;
  name: string;
  description: string;
  logoUri: string | null;
  mint: string;
  currency: string;
  exchange: string | null;
  tradingHoursMode: string | null;
  tradingPeriod: string | null;
  openNow: boolean | null;
  nextTradingChangeAt: string | null;
  isTradingHalted: boolean;
  supportsAtomicSwaps: boolean;
  referencePrice: string | null;
  referencePriceSource: 'xstocks' | 'jupiter' | null;
  referencePriceFetchedAt: number | null;
  multiplier: StockMultiplierSnapshot | null;
  token: TokenInfo | null;
}

export interface StockCatalogResponse {
  assets: StockAsset[];
  status: 'live' | 'stale';
  directoryComplete: boolean;
  fetchedAt: number;
  provider: 'xStocks';
  warning: string | null;
}

export interface StockTradeContext {
  side: StockTradeSide;
  symbol: string;
  underlyingSymbol: string;
  mint: string;
  multiplier: StockMultiplierSnapshot;
  requestedDisplayAmount: string;
  normalizedInputDisplay: string;
  expectedOutputDisplay: string;
  minimumOutputDisplay: string;
  referencePrice: string | null;
  referencePriceFetchedAt: number | null;
}

export interface StockQuoteResponse {
  asset: StockAsset;
  trade: StockTradeContext;
  quoteResponse: QuoteResponse;
}

export type PreparedKind = 'market-swap' | 'limit-create' | 'limit-cancel';

export interface GasPayment {
  mode: 'provider-sponsored' | 'user-paid';
  provider: 'Jupiter' | 'Privy' | null;
  feePayer: string | null;
  signatureFeeLamports: string | null;
  prioritizationFeeLamports: string | null;
  rentFeeLamports: string | null;
  totalWalletDebitLamports?: string | null;
  detail: string;
}

export interface PreparedTransaction {
  preparedId: string;
  kind: PreparedKind;
  provider: QuoteProvider | 'jupiter-trigger';
  providerLabel: string;
  wallet: string;
  transaction: string;
  messageHash: string;
  expiresAt: number;
  gasPayment?: GasPayment;
  review: {
    inputToken?: TokenInfo;
    outputToken?: TokenInfo;
    inputAmount?: string;
    expectedOutput?: string;
    minimumOutput?: string;
    slippageBps?: number;
    networkFeeLamports?: string | null;
    routeLabel?: string;
    fees?: QuoteFee[];
    priceImpactPct?: number | null;
    order?: string;
    custody?: string;
    stock?: StockTradeContext;
    warnings: string[];
  };
}

export interface ExecutionResult {
  signature: string;
  status: 'submitted' | 'confirmed';
  explorerUrl: string;
  provider: string;
  gasPayment?: GasPayment;
}

export type AlchemyPayEnvironment = 'test' | 'production';
export type FiatOrderStatus = 'created' | 'payment-pending' | 'provider-failed' | 'provider-finished' | 'confirmed' | 'expired' | 'review-required';

export interface AlchemyPayCapability {
  configured: boolean;
  environment: AlchemyPayEnvironment;
  provider: 'Alchemy Pay';
  asset: 'USDC';
  network: 'SOL';
  allowedFiat: string[];
  minFiatAmount: string;
  maxFiatAmount: string;
}

export interface FiatOrder {
  merchantOrderNo: string;
  wallet: string;
  fiat: string;
  fiatAmount: string;
  crypto: 'USDC';
  network: 'SOL';
  status: FiatOrderStatus;
  providerStatus: string | null;
  providerOrderNo: string | null;
  cryptoQuantity: string | null;
  rampFee: string | null;
  txHash: string | null;
  checkoutUrl: string;
  environment: AlchemyPayEnvironment;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  confirmedAt: number | null;
  error: string | null;
}

export interface AlchemyPayCheckout {
  order: FiatOrder;
  provider: 'Alchemy Pay';
  disclosure: string[];
}

export interface ActivityDelta {
  mint: string;
  symbol: string;
  decimals: number;
  amountAtomic: string;
  uiAmount: string;
}

export interface ActivityRecord {
  signature: string;
  explorerUrl: string;
  status: 'pending' | 'confirmed' | 'failed';
  blockTime: number | null;
  slot: number | null;
  feeLamports: string | null;
  error: string | null;
  deltas: ActivityDelta[];
}

export interface TriggerOrder {
  order: string;
  status: string;
  inputMint: string;
  outputMint: string;
  makingAmount: string;
  takingAmount: string;
  remainingMakingAmount: string | null;
  remainingTakingAmount: string | null;
  createdAt: string | null;
  expiredAt: number | null;
  rawStatus: string;
}

export interface TriggerOrdersResponse {
  orders: TriggerOrder[];
  hasMoreData: boolean;
  page: number;
  providerLabel: 'Jupiter Trigger V1';
  custody: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details?: unknown;
  };
}

export type MagicBlockAction = 'deposit' | 'private-transfer' | 'withdraw';

export interface MagicBlockStatus {
  available: boolean;
  cluster: 'mainnet';
  token: {
    mint: string;
    symbol: 'USDC';
    decimals: 6;
  };
  mintInitialized: boolean;
  privateTransfers: boolean;
  teeAttested: boolean;
  authorizationMode: 'verified' | 'mock' | 'unavailable';
  detail: string;
  checkedAt: number;
  provider: 'MagicBlock Ephemeral SPL Token';
}

export interface MagicBlockBalance {
  wallet: string;
  mint: string;
  symbol: 'USDC';
  decimals: 6;
  amountAtomic: string;
  uiAmount: string;
  location: 'ephemeral';
  protected: true;
  unlockedUntil: number;
  fetchedAt: number;
  authorization: {
    source: 'MagicBlock mainnet TEE';
    walletSignature: 'verified';
    teeAttestation: 'verified';
    providerToken: 'accepted';
    receiptFingerprint: string;
    authorizedAt: number;
    expiresAt: number;
  };
}

export interface MagicBlockPreparedTransaction {
  preparedId: string;
  action: MagicBlockAction;
  provider: 'MagicBlock Ephemeral SPL Token';
  wallet: string;
  recipient: string | null;
  mint: string;
  symbol: 'USDC';
  decimals: 6;
  amountAtomic: string;
  transaction: string;
  messageHash: string;
  sendTo: 'base' | 'ephemeral';
  expiresAt: number;
  review: {
    mode: string;
    source: string;
    destination: string;
    providerFees: {
      lamports: string;
      tokens: string;
    };
    warnings: string[];
  };
}

export interface MagicBlockExecution {
  signature: string;
  confirmed: boolean;
  sendTo: 'base' | 'ephemeral';
  networkLabel: string;
  explorerUrl: string | null;
  provider: 'MagicBlock Ephemeral SPL Token';
}

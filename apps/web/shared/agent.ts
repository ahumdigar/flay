import type { FuturesExecution, FuturesPreparedStep, FuturesRouteChoice, FuturesSide, FuturesVenue } from './futures.js';
import type { ExecutionResult, GasPayment, PreparedTransaction, StockTradeContext, StockTradeSide } from './types.js';

export type AgentProduct = 'convert' | 'stocks' | 'futures';
export type AgentRequestStatus = 'pending' | 'prepared' | 'rejected' | 'expired' | 'failed' | 'completed';
export type AgentApprovalMode = 'always-ask' | 'automatic';

export interface AgentPolicyInput {
  name: string;
  approvalMode: AgentApprovalMode;
  products: AgentProduct[];
  maxTransactionUsd: number;
  maxDailyUsd: number;
  maxSlippageBps: number;
  maxFuturesLeverage: number;
  maxOpenFuturesPositions: number;
  allowedTokenMints: string[];
  allowedStockSymbols: string[];
  allowedFuturesMarkets: Array<'SOL-PERP' | 'BTC-PERP' | 'ETH-PERP'>;
  expiresInHours: number;
}

export interface AgentCredentialSummary {
  id: string;
  name: string;
  wallet: string;
  approvalMode: AgentApprovalMode;
  status: 'active' | 'expired' | 'revoked';
  products: AgentProduct[];
  maxTransactionUsd: number;
  maxDailyUsd: number;
  maxSlippageBps: number;
  maxFuturesLeverage: number;
  maxOpenFuturesPositions: number;
  allowedTokenMints: string[];
  allowedStockSymbols: string[];
  allowedFuturesMarkets: string[];
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

export interface AgentCredentialCreated {
  credential: string;
  summary: AgentCredentialSummary;
  warning: string;
}

export interface AgentConvertIntent {
  kind: 'convert';
  inputMint: string;
  outputMint: string;
  amountAtomic: string;
  slippageBps: number;
}

export interface AgentStockIntent {
  kind: 'stock';
  symbol: string;
  side: StockTradeSide;
  amount: string;
  slippageBps: number;
}

export interface AgentFuturesOpenIntent {
  kind: 'futures-open';
  market: 'SOL-PERP' | 'BTC-PERP' | 'ETH-PERP';
  side: FuturesSide;
  orderType: 'market' | 'limit';
  collateralAtomic: string;
  leverageBps: number;
  limitPriceMicroUsd?: string;
  slippageBps: number;
  routeChoice: FuturesRouteChoice;
}

export interface AgentFuturesManageIntent {
  kind: 'futures-manage';
  action: 'close' | 'cancel';
  venue: FuturesVenue;
  market: 'SOL-PERP' | 'BTC-PERP' | 'ETH-PERP';
  nativeId: string;
}

export type AgentIntent = AgentConvertIntent | AgentStockIntent | AgentFuturesOpenIntent | AgentFuturesManageIntent;

export interface AgentIntentSubmission {
  idempotencyKey: string;
  intent: AgentIntent;
}

export interface AgentExecutionSummary {
  signature: string;
  status: string;
  explorerUrl: string;
  provider: string;
  completedAt: number;
  marketActivity?: {
    kind: 'Market' | 'Stock';
    gasPayment?: GasPayment;
    stock?: StockTradeContext;
  };
}

export interface AgentRequest {
  id: string;
  credentialId: string;
  credentialName: string;
  wallet: string;
  approvalMode: AgentApprovalMode;
  intent: AgentIntent;
  riskUsd: string;
  status: AgentRequestStatus;
  createdAt: number;
  expiresAt: number;
  reviewedAt: number | null;
  rejectedAt: number | null;
  failure: string | null;
  execution: AgentExecutionSummary | null;
}

export type AgentPreparedAction =
  | { type: 'market'; prepared: PreparedTransaction }
  | { type: 'futures'; prepared: FuturesPreparedStep };

export interface AgentReviewResponse {
  request: AgentRequest;
  action: AgentPreparedAction;
}

export interface AgentExecutionResponse {
  request: AgentRequest;
  result: ExecutionResult | FuturesExecution;
}

export interface AgentWorkspaceResponse {
  credentials: AgentCredentialSummary[];
  requests: AgentRequest[];
  events: AgentAuditEvent[];
  security: {
    approvalModes: AgentApprovalMode[];
    automaticExecutionConfigured: boolean;
    fiatOnrampAvailable: false;
    arbitraryWalletAccess: false;
    credentialStorage: 'sha256-hash-only';
  };
}

export interface AgentAuditEvent {
  id: string;
  wallet: string;
  credentialId: string | null;
  requestId: string | null;
  type: 'credential-created' | 'credential-revoked' | 'request-created' | 'request-prepared' | 'request-rejected' | 'request-failed' | 'request-completed';
  detail: string;
  createdAt: number;
}

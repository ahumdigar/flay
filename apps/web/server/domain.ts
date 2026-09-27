import type { ExecutionResult, MarketQuote, PreparedKind, PreparedTransaction, QuoteProvider, StockTradeContext, TokenInfo } from '../shared/types.js';
import type { TransactionExpectations } from './transaction-validation.js';

export interface ProviderQuoteResult {
  quote: Omit<MarketQuote, 'id'>;
  raw: unknown;
  context: Record<string, unknown>;
}

export interface QuoteSnapshot {
  id: string;
  quote: MarketQuote;
  raw: unknown;
  context: Record<string, unknown>;
  inputToken: TokenInfo;
  outputToken: TokenInfo;
  stock?: StockTradeContext;
}

export interface PreparedRecord {
  public: PreparedTransaction;
  kind: PreparedKind;
  provider: QuoteProvider | 'jupiter-trigger';
  wallet: string;
  unsignedMessage: Uint8Array;
  requestId?: string;
  submissionMode?: 'provider-execute' | 'rpc';
  order?: string;
  executedSignature?: string;
  executionResult?: ExecutionResult;
  expectations: TransactionExpectations;
}

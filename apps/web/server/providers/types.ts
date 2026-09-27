import type { VersionedTransaction } from '@solana/web3.js';
import type { GasPayment } from '../../shared/types.js';
import type { ProviderQuoteResult } from '../domain.js';

export interface QuoteRequest {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  executionWallet?: string;
  jupiterMode?: 'meta' | 'router';
}

export interface PrepareRequest extends QuoteRequest {
  wallet: string;
  inputTokenProgram: 'native' | 'spl-token' | 'token-2022';
  outputTokenProgram: 'native' | 'spl-token' | 'token-2022';
  context?: Record<string, unknown>;
}

export interface ProviderPrepared {
  transaction: VersionedTransaction;
  transactionBase64: string;
  requestId?: string;
  expectedPrograms: string[];
  expectedPoolIds: string[];
  networkFeeLamports: string | null;
  gasPayment?: GasPayment;
  allowedExternalSigners?: string[];
  rejectUnknownSigners?: boolean;
  submissionMode?: 'provider-execute' | 'rpc';
  finalQuote?: ProviderQuoteResult['quote'];
}

export interface QuoteAdapter {
  quote(request: QuoteRequest): Promise<ProviderQuoteResult>;
  prepare(request: PrepareRequest, freshQuote: ProviderQuoteResult): Promise<ProviderPrepared>;
}

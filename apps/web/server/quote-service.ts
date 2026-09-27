import type {
  ExecutionResult,
  GasPayment,
  ProviderFailure,
  QuoteProvider,
  QuoteResponse,
  StockTradeContext,
  TokenInfo,
} from '../shared/types.js';
import bs58 from 'bs58';
import { VersionedTransaction, type VersionedTransactionResponse } from '@solana/web3.js';
import { atomicToDecimal } from '../shared/amounts.js';
import { PREPARED_TTL_MS } from '../shared/constants.js';
import { checkSpendableBalance } from './balance-check.js';
import { config, providerHeaders } from './config.js';
import type { QuoteSnapshot } from './domain.js';
import { AppError, asAppError } from './errors.js';
import { fetchJson } from './fetch-json.js';
import { EphemeralStore } from './prepared-store.js';
import { JupiterAdapter } from './providers/jupiter.js';
import { OrcaAdapter } from './providers/orca.js';
import { RaydiumAdapter } from './providers/raydium.js';
import type { QuoteAdapter, QuoteRequest } from './providers/types.js';
import { withRpcFallback } from './rpc.js';
import { TokenService } from './tokens.js';
import {
  assertMessageUnchanged,
  assertPrivySponsoredMarketReceipt,
  assertPrivySponsoredMarketTransactionSafe,
  assertWalletSignature,
  deserializeSignedTransaction,
  simulateAndVerifyDeltas,
  validateTransactionStructure,
  type TransactionExpectations,
} from './transaction-validation.js';

interface CachedQuotes {
  expiresAt: number;
  response: QuoteResponse;
}

export interface QuoteOptions {
  providers?: QuoteProvider[];
  inputToken?: TokenInfo;
  outputToken?: TokenInfo;
  stock?: StockTradeContext;
}

interface JupiterExecute {
  status?: string;
  signature?: string;
  error?: string;
  code?: number;
  inputAmountResult?: string;
  outputAmountResult?: string;
  totalOutputAmount?: string;
}

const ADAPTERS: Record<QuoteProvider, QuoteAdapter> = {
  jupiter: new JupiterAdapter(),
  raydium: new RaydiumAdapter(),
  orca: new OrcaAdapter(),
};

export function inferRoutePrices(
  inputToken: TokenInfo,
  outputToken: TokenInfo,
  best?: QuoteSnapshot,
): { inputToken: TokenInfo; outputToken: TokenInfo } {
  if (!best) return { inputToken, outputToken };
  const inputUnits = Number(best.quote.inAmount) / 10 ** inputToken.decimals;
  const outputUnits = Number(best.quote.outAmount) / 10 ** outputToken.decimals;
  if (!(inputUnits > 0) || !(outputUnits > 0)) return { inputToken, outputToken };
  if (inputToken.usdPrice === null && outputToken.usdPrice !== null) {
    return { inputToken: { ...inputToken, usdPrice: outputUnits * outputToken.usdPrice / inputUnits }, outputToken };
  }
  if (outputToken.usdPrice === null && inputToken.usdPrice !== null) {
    return { inputToken, outputToken: { ...outputToken, usdPrice: inputUnits * inputToken.usdPrice / outputUnits } };
  }
  return { inputToken, outputToken };
}

export function rankQuoteSnapshots(quotes: QuoteSnapshot[]): QuoteSnapshot[] {
  return [...quotes].sort((left, right) => {
    const a = BigInt(left.quote.outAmount);
    const b = BigInt(right.quote.outAmount);
    return a === b ? 0 : a > b ? -1 : 1;
  });
}

export function shouldCacheQuoteResponse(response: QuoteResponse): boolean {
  // A response with no executable route only captures a momentary provider
  // failure. Replaying it from cache prevents a bounded recovery attempt from
  // reaching the provider again.
  return response.quotes.length > 0;
}

export function applySimulatedUserPaidCost(
  gasPayment: GasPayment,
  walletLamportDelta: bigint,
  networkFeeLamports: string | null,
): GasPayment {
  if (gasPayment.mode !== 'user-paid') return gasPayment;
  const totalDebit = walletLamportDelta < 0n ? -walletLamportDelta : 0n;
  const knownNetworkFee = /^\d+$/.test(networkFeeLamports ?? '') ? BigInt(networkFeeLamports!) : 0n;
  const nonNetworkDebit = totalDebit > knownNetworkFee ? totalDebit - knownNetworkFee : 0n;
  const totalSol = atomicToDecimal(totalDebit.toString(), 9);
  const networkSol = atomicToDecimal(knownNetworkFee.toString(), 9);
  const nonNetworkSol = atomicToDecimal(nonNetworkDebit.toString(), 9);
  return {
    ...gasPayment,
    signatureFeeLamports: gasPayment.signatureFeeLamports ?? networkFeeLamports,
    rentFeeLamports: nonNetworkDebit > 0n ? nonNetworkDebit.toString() : '0',
    totalWalletDebitLamports: totalDebit.toString(),
    detail: nonNetworkDebit > 0n
      ? `Your wallet pays approximately ${totalSol} SOL total: ${networkSol} SOL network gas and ${nonNetworkSol} SOL account rent or other transaction-required SOL.`
      : `Your wallet pays approximately ${totalSol} SOL in network gas for this exact simulated transaction.`,
  };
}

export class QuoteService {
  private readonly cache = new Map<string, CachedQuotes>();
  private readonly inflight = new Map<string, Promise<QuoteResponse>>();

  constructor(
    private readonly tokens: TokenService,
    private readonly store: EphemeralStore,
  ) {}

  async quotes(request: QuoteRequest, options: QuoteOptions = {}): Promise<QuoteResponse> {
    const providerScope = (options.providers ?? (Object.keys(ADAPTERS) as QuoteProvider[])).join(',');
    const stockScope = options.stock ? `${options.stock.symbol}:${options.stock.side}:${options.stock.multiplier.value}` : 'convert';
    const executionScope = request.executionWallet ?? 'quote-only';
    const jupiterMode = request.jupiterMode ?? 'meta';
    const key = `${request.inputMint}:${request.outputMint}:${request.amount}:${request.slippageBps}:${providerScope}:${stockScope}:${executionScope}:${jupiterMode}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.response;
    if (cached) this.cache.delete(key);
    if (this.cache.size >= 1_000) {
      const now = Date.now();
      for (const [cacheKey, value] of this.cache) if (value.expiresAt <= now) this.cache.delete(cacheKey);
      if (this.cache.size >= 1_000) {
        const oldest = this.cache.keys().next().value as string | undefined;
        if (oldest) this.cache.delete(oldest);
      }
    }
    const running = this.inflight.get(key);
    if (running) return running;

    const promise = this.loadQuotes(request, options, key).finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  private async loadQuotes(request: QuoteRequest, options: QuoteOptions, cacheKey: string): Promise<QuoteResponse> {
    const [inputToken, outputToken] = await Promise.all([
      options.inputToken?.mint === request.inputMint ? options.inputToken : this.tokens.getByMint(request.inputMint),
      options.outputToken?.mint === request.outputMint ? options.outputToken : this.tokens.getByMint(request.outputMint),
    ]);
    if (!inputToken.tradable) throw new AppError(409, 'INPUT_TOKEN_UNSUPPORTED', inputToken.blockedReason ?? 'The input token is unsupported.');
    if (!outputToken.tradable) throw new AppError(409, 'OUTPUT_TOKEN_UNSUPPORTED', outputToken.blockedReason ?? 'The output token is unsupported.');

    const requestedProviders = options.providers ?? (Object.keys(ADAPTERS) as QuoteProvider[]);
    const providers = requestedProviders.map((provider) => [provider, ADAPTERS[provider]] as [QuoteProvider, QuoteAdapter]);
    const settled = await Promise.allSettled(providers.map(([, adapter]) => adapter.quote(request)));
    const quotes: QuoteSnapshot[] = [];
    const failures: ProviderFailure[] = [];

    settled.forEach((result, index) => {
      const provider = providers[index][0];
      if (result.status === 'fulfilled') {
        const quoteWithId = { ...result.value.quote, id: '' };
        quotes.push(this.store.putQuote({
          quote: quoteWithId,
          raw: result.value.raw,
          context: result.value.context,
          inputToken,
          outputToken,
          ...(options.stock ? { stock: options.stock } : {}),
        }));
      } else {
        const error = asAppError(result.reason, 'QUOTE_FAILED');
        failures.push({
          provider,
          message: error.message,
          code: error.code,
          retryable: error.retryable,
        });
      }
    });

    const rankedQuotes = rankQuoteSnapshots(quotes);
    const pricedTokens = inferRoutePrices(inputToken, outputToken, rankedQuotes[0]);
    const response: QuoteResponse = {
      inputToken: pricedTokens.inputToken,
      outputToken: pricedTokens.outputToken,
      quotes: rankedQuotes.map((entry) => entry.quote),
      failures,
      bestQuoteId: rankedQuotes[0]?.id ?? null,
      requestedAt: Date.now(),
    };
    if (shouldCacheQuoteResponse(response)) {
      this.cache.set(
        cacheKey,
        { expiresAt: Date.now() + config.quoteCacheMs, response },
      );
    }
    return response;
  }

  async prepare(quoteId: string, wallet: string) {
    const selected = this.store.getQuote(quoteId);
    const boundWallet = typeof selected.context.executionWallet === 'string' ? selected.context.executionWallet : null;
    if (boundWallet && boundWallet !== wallet) {
      throw new AppError(403, 'QUOTE_WALLET_MISMATCH', 'This executable route belongs to another wallet. Request a fresh route.');
    }
    const request: QuoteRequest = {
      inputMint: selected.quote.inputMint,
      outputMint: selected.quote.outputMint,
      amount: selected.quote.inAmount,
      slippageBps: selected.quote.slippageBps,
      ...(boundWallet ? { executionWallet: boundWallet } : {}),
      ...(selected.context.jupiterMode === 'router' ? { jupiterMode: 'router' as const } : {}),
    };
    const privyMaySponsor = (selected.quote.provider === 'raydium' || selected.quote.provider === 'orca')
      && selected.inputToken.tokenProgram !== 'native'
      && selected.outputToken.tokenProgram !== 'native';
    // Every market route below is freshly built, structurally validated, and
    // simulated before signing. Check the exact principal here and let that
    // mandatory simulation determine the real network-fee and rent boundary.
    await checkSpendableBalance(wallet, selected.inputToken, request.amount, {
      solReserveLamports: 0n,
    });
    const adapter = ADAPTERS[selected.quote.provider];
    let fresh;
    if (selected.context.jupiterMode === 'router' && boundWallet === wallet) {
      const { id: _id, ...selectedQuote } = selected.quote;
      fresh = { raw: selected.raw, context: selected.context, quote: selectedQuote };
    } else {
      fresh = await adapter.quote(request);
    }
    const prepared = await adapter.prepare({
      ...request,
      wallet,
      inputTokenProgram: selected.inputToken.tokenProgram,
      outputTokenProgram: selected.outputToken.tokenProgram,
      context: fresh.context,
    }, fresh);

    const finalQuote = prepared.finalQuote ?? fresh.quote;
    const expectations: TransactionExpectations = {
      kind: 'market-swap',
      provider: selected.quote.provider,
      wallet,
      inputToken: selected.inputToken,
      outputToken: selected.outputToken,
      inputAmount: request.amount,
      minimumOutput: finalQuote.minimumOut,
      expectedPrograms: prepared.expectedPrograms,
      expectedPoolIds: prepared.expectedPoolIds,
      feePayer: prepared.gasPayment?.feePayer ?? wallet,
      allowedExternalSigners: prepared.allowedExternalSigners,
      rejectUnknownSigners: prepared.rejectUnknownSigners,
    };
    const validated = await validateTransactionStructure(prepared.transaction, expectations);
    const simulation = await simulateAndVerifyDeltas(prepared.transaction, expectations, validated, false);

    let privySponsored = false;
    let sponsorshipWarning: string | null = null;
    if (privyMaySponsor) {
      try {
        await assertPrivySponsoredMarketTransactionSafe(prepared.transaction, expectations);
        privySponsored = true;
      } catch (error) {
        const ineligible = asAppError(error, 'PRIVY_SPONSORSHIP_INELIGIBLE');
        if (ineligible.code !== 'PRIVY_SPONSORSHIP_INELIGIBLE') throw error;
        sponsorshipWarning = ineligible.message;
      }
    }

    const baseGasPayment = prepared.gasPayment ?? (privySponsored ? {
      mode: 'provider-sponsored' as const,
      provider: 'Privy' as const,
      feePayer: null,
      signatureFeeLamports: prepared.networkFeeLamports,
      prioritizationFeeLamports: null,
      rentFeeLamports: '0',
      detail: 'Privy supplies a managed Solana fee payer for this reviewed venue transaction. Your wallet pays no network gas.',
    } : {
      mode: 'user-paid' as const,
      provider: null,
      feePayer: wallet,
      signatureFeeLamports: prepared.networkFeeLamports,
      prioritizationFeeLamports: null,
      rentFeeLamports: null,
      detail: 'Your wallet pays this order’s Solana network gas.',
    });
    const gasPayment = applySimulatedUserPaidCost(
      baseGasPayment,
      simulation.walletLamportDelta,
      prepared.networkFeeLamports,
    );

    const expiresAt = Math.min(Date.now() + PREPARED_TTL_MS, finalQuote.expiresAt + PREPARED_TTL_MS);
    const record = this.store.putPrepared({
      kind: 'market-swap',
      provider: selected.quote.provider,
      wallet,
      unsignedMessage: validated.messageBytes,
      requestId: prepared.requestId,
      submissionMode: prepared.submissionMode,
      expectations,
      public: {
        kind: 'market-swap',
        provider: selected.quote.provider,
        providerLabel: finalQuote.providerLabel,
        wallet,
        transaction: prepared.transactionBase64,
        messageHash: validated.messageHash,
        expiresAt,
        gasPayment,
        review: {
          inputToken: selected.inputToken,
          outputToken: selected.outputToken,
          inputAmount: request.amount,
          expectedOutput: finalQuote.outAmount,
          minimumOutput: finalQuote.minimumOut,
          slippageBps: request.slippageBps,
          networkFeeLamports: prepared.networkFeeLamports,
          routeLabel: finalQuote.routeLabel,
          fees: finalQuote.fees,
          priceImpactPct: finalQuote.priceImpactPct,
          ...(selected.stock ? { stock: selected.stock } : {}),
          warnings: [
            ...finalQuote.warnings,
            'Flay simulated this exact message and verified wallet input and minimum-output deltas.',
            ...(privySponsored ? ['Privy sponsorship is restricted to this single SPL-to-SPL transaction with existing token accounts.'] : []),
            ...(sponsorshipWarning ? [`Gas sponsorship unavailable: ${sponsorshipWarning}`] : []),
          ],
        },
      },
    });
    return record.public;
  }

  async execute(preparedId: string, signedBase64: string): Promise<ExecutionResult> {
    const record = this.store.getPrepared(preparedId);
    if (record.executionResult) return record.executionResult;
    if (record.public.gasPayment?.provider === 'Privy') {
      throw new AppError(409, 'PRIVY_SPONSORED_EXECUTION_REQUIRED', 'This reviewed conversion must be sponsored and broadcast by Privy. Prepare it again if the review changed.');
    }
    if (record.executedSignature) throw new AppError(500, 'EXECUTION_RESULT_MISSING', 'The completed execution record is incomplete.');
    const transaction = deserializeSignedTransaction(signedBase64);
    assertMessageUnchanged(transaction, record.unsignedMessage);
    const validated = await validateTransactionStructure(transaction, record.expectations);
    assertWalletSignature(transaction, record.wallet);
    const providerSponsored = record.provider === 'jupiter' && record.public.gasPayment?.mode === 'provider-sponsored';
    await simulateAndVerifyDeltas(transaction, record.expectations, validated, !providerSponsored);

    let signature: string;
    let confirmed = false;
    if ((record.provider === 'jupiter' && record.submissionMode !== 'rpc') || record.provider === 'jupiter-trigger') {
      if (!record.requestId) throw new AppError(500, 'PROVIDER_REQUEST_ID_MISSING', 'The provider execution reference is missing.');
      const endpoint = record.provider === 'jupiter' ? '/swap/v2/execute' : '/trigger/v1/execute';
      const payload = await fetchJson<JupiterExecute>(new URL(endpoint, config.jupiterBaseUrl), {
        method: 'POST',
        provider: record.provider === 'jupiter' ? 'Jupiter' : 'Jupiter Trigger',
        headers: providerHeaders(true),
        timeoutMs: 35_000,
        body: JSON.stringify({ signedTransaction: signedBase64, requestId: record.requestId }),
      });
      if (payload.status?.toLowerCase() === 'failed' || payload.error || !payload.signature) {
        throw new AppError(409, 'PROVIDER_EXECUTION_FAILED', `${record.public.providerLabel}: ${payload.error ?? 'execution failed'}`, true);
      }
      if (
        record.kind === 'market-swap'
        && (payload.totalOutputAmount || payload.outputAmountResult)
        && BigInt(payload.totalOutputAmount ?? payload.outputAmountResult!) < BigInt(record.expectations.minimumOutput ?? '0')
      ) {
        throw new AppError(502, 'PROVIDER_RESULT_MISMATCH', 'Jupiter reported an output below the reviewed minimum.');
      }
      signature = payload.signature;
      confirmed = payload.status?.toLowerCase() === 'success';
    } else {
      signature = await withRpcFallback((rpc) => rpc.sendRawTransaction(Buffer.from(signedBase64, 'base64'), {
        skipPreflight: false,
        maxRetries: 3,
      }));
      confirmed = await waitForConfirmation(signature);
    }
    const result: ExecutionResult = {
      signature,
      status: confirmed ? 'confirmed' : 'submitted',
      explorerUrl: explorer(signature),
      provider: record.public.providerLabel,
      gasPayment: record.public.gasPayment,
    };
    this.store.markExecuted(preparedId, result);
    return result;
  }

  async completePrivySponsored(preparedId: string, signature: string): Promise<ExecutionResult> {
    const record = this.store.getPrepared(preparedId);
    if (record.executionResult) {
      if (record.executionResult.signature !== signature) {
        throw new AppError(409, 'SPONSORED_COMPLETION_CONFLICT', 'This reviewed conversion was already completed with another signature.');
      }
      return record.executionResult;
    }
    if (record.executedSignature && record.executedSignature !== signature) {
      throw new AppError(409, 'SPONSORED_COMPLETION_CONFLICT', 'This reviewed conversion was already submitted with another signature.');
    }
    if (
      record.kind !== 'market-swap'
      || (record.provider !== 'raydium' && record.provider !== 'orca')
      || record.public.gasPayment?.mode !== 'provider-sponsored'
      || record.public.gasPayment.provider !== 'Privy'
    ) {
      throw new AppError(409, 'SPONSORED_PREPARATION_MISMATCH', 'This preparation is not an eligible Privy-sponsored market conversion.');
    }
    this.store.markSubmitted(preparedId, signature);

    let response: VersionedTransactionResponse | null = null;
    for (let attempt = 0; attempt < 8 && !response; attempt += 1) {
      response = await withRpcFallback((rpc) => rpc.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      }));
      if (!response) await new Promise((resolve) => setTimeout(resolve, 400));
    }
    if (!response?.meta) {
      throw new AppError(409, 'SPONSORED_RECEIPT_PENDING', 'Solana has not returned the sponsored conversion receipt yet. Retry confirmation.', true);
    }

    const transaction = new VersionedTransaction(response.transaction.message);
    transaction.signatures = response.transaction.signatures.map((value) => bs58.decode(value));
    const actualFeePayer = transaction.message.staticAccountKeys[0]?.toBase58();
    if (!actualFeePayer) throw new AppError(409, 'SPONSOR_FEE_PAYER_MISSING', 'The confirmed transaction has no fee payer.');
    const finalExpectations: TransactionExpectations = {
      ...record.expectations,
      feePayer: actualFeePayer,
      allowedExternalSigners: [actualFeePayer],
      rejectUnknownSigners: true,
    };
    await validateTransactionStructure(transaction, finalExpectations);
    assertWalletSignature(transaction, record.wallet);

    const accountKeys = transaction.message.getAccountKeys({ accountKeysFromLookups: response.meta.loadedAddresses });
    assertPrivySponsoredMarketReceipt({
      signature,
      transactionSignatures: response.transaction.signatures,
      accountKeys: Array.from({ length: accountKeys.length }, (_, index) => accountKeys.get(index)!.toBase58()),
      feeLamports: response.meta.fee,
      error: response.meta.err,
      preBalances: response.meta.preBalances,
      postBalances: response.meta.postBalances,
      preTokenBalances: response.meta.preTokenBalances ?? [],
      postTokenBalances: response.meta.postTokenBalances ?? [],
    }, finalExpectations);

    const result: ExecutionResult = {
      signature,
      status: 'confirmed',
      explorerUrl: explorer(signature),
      provider: record.public.providerLabel,
      gasPayment: {
        ...record.public.gasPayment,
        feePayer: actualFeePayer,
        signatureFeeLamports: String(response.meta.fee),
        detail: 'Privy paid this confirmed conversion’s Solana network gas through its managed fee payer.',
      },
    };
    this.store.markExecuted(preparedId, result);
    return result;
  }
}

async function waitForConfirmation(signature: string): Promise<boolean> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await withRpcFallback((rpc) => rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }));
    const status = response.value[0];
    if (status?.err) throw new AppError(409, 'TRANSACTION_FAILED', 'The submitted Solana transaction failed onchain.', false, { reason: status.err });
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return true;
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  return false;
}

function explorer(signature: string): string {
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=mainnet-beta`;
}

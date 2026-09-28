import type { AgentExecutionResponse, AgentIntent, AgentIntentSubmission, AgentPolicyInput, AgentReviewResponse } from '../../shared/agent.js';
import type { FuturesIntent, FuturesRouteQuote } from '../../shared/futures.js';
import { decimalToAtomic } from '../../shared/amounts.js';
import { AppError, asAppError } from '../errors.js';
import type { FuturesService } from '../futures/futures-service.js';
import type { FuturesTransactionService } from '../futures/transaction-service.js';
import type { QuoteService } from '../quote-service.js';
import type { StockService } from '../stocks-service.js';
import type { TokenService } from '../tokens.js';
import { AgentStore, type AgentCredentialRecord, type AgentRequestRecord } from './store.js';

const MICRO_USD = 1_000_000n;

function usdToMicro(value: number): bigint {
  if (!Number.isFinite(value) || value < 0) throw new AppError(400, 'AGENT_VALUE_INVALID', 'The request value is invalid.');
  return BigInt(Math.ceil(value * Number(MICRO_USD)));
}

function microToUsd(value: bigint): string {
  return value.toString();
}

function product(intent: AgentIntent): 'convert' | 'stocks' | 'futures' {
  if (intent.kind === 'convert') return 'convert';
  if (intent.kind === 'stock') return 'stocks';
  return 'futures';
}

function assertPolicyBasics(policy: AgentPolicyInput, intent: AgentIntent) {
  const requestedProduct = product(intent);
  if (!policy.products.includes(requestedProduct)) throw new AppError(403, 'AGENT_PRODUCT_DENIED', `${requestedProduct} is disabled for this agent.`);
  if ('slippageBps' in intent && intent.slippageBps > policy.maxSlippageBps) {
    throw new AppError(403, 'AGENT_SLIPPAGE_LIMIT', `This request exceeds the ${policy.maxSlippageBps / 100}% slippage guardrail.`);
  }
  if (intent.kind === 'convert' && (!policy.allowedTokenMints.includes(intent.inputMint) || !policy.allowedTokenMints.includes(intent.outputMint))) {
    throw new AppError(403, 'AGENT_TOKEN_DENIED', 'This token pair is outside the agent allowlist.');
  }
  if (intent.kind === 'stock' && !policy.allowedStockSymbols.includes(intent.symbol.toUpperCase())) {
    throw new AppError(403, 'AGENT_STOCK_DENIED', 'This xStock is outside the agent allowlist.');
  }
  if ((intent.kind === 'futures-open' || intent.kind === 'futures-manage') && !policy.allowedFuturesMarkets.includes(intent.market)) {
    throw new AppError(403, 'AGENT_FUTURES_MARKET_DENIED', 'This futures market is outside the agent allowlist.');
  }
  if (intent.kind === 'futures-open' && intent.leverageBps > policy.maxFuturesLeverage * 10_000) {
    throw new AppError(403, 'AGENT_LEVERAGE_LIMIT', `This request exceeds the ${policy.maxFuturesLeverage}× leverage guardrail.`);
  }
}

export class AgentService {
  readonly store = new AgentStore();

  constructor(
    private readonly tokens: TokenService,
    private readonly quotes: QuoteService,
    private readonly stocks: StockService,
    private readonly futures: FuturesService,
    private readonly futuresTransactions: FuturesTransactionService,
  ) {}

  createCredential(userId: string, wallet: string, policy: AgentPolicyInput) {
    return this.store.createCredential(userId, wallet, policy);
  }

  workspace(userId: string, wallet: string) {
    return this.store.workspace(userId, wallet);
  }

  revoke(userId: string, wallet: string, id: string) {
    return this.store.revoke(userId, wallet, id);
  }

  async submit(rawCredential: string | undefined, submission: AgentIntentSubmission) {
    const credential = this.store.authenticate(rawCredential);
    const policy = this.store.policy(credential);
    assertPolicyBasics(policy, submission.intent);
    const existing = this.store.existingRequest(credential, submission.idempotencyKey, submission.intent);
    if (existing) return existing;
    const risk = await this.riskMicroUsd(credential, policy, submission.intent);
    const maximum = usdToMicro(policy.maxTransactionUsd);
    if (risk > maximum) throw new AppError(403, 'AGENT_TRANSACTION_LIMIT', `This request exceeds the $${policy.maxTransactionUsd} per-request guardrail.`);
    const daily = this.store.dailyRiskMicroUsd(credential.id);
    if (daily + risk > usdToMicro(policy.maxDailyUsd)) throw new AppError(403, 'AGENT_DAILY_LIMIT', `This request would exceed the rolling $${policy.maxDailyUsd} daily guardrail.`);
    return this.store.createRequest(credential, submission.idempotencyKey, submission.intent, microToUsd(risk));
  }

  async review(userId: string, wallet: string, id: string): Promise<AgentReviewResponse> {
    const request = this.store.ownedRequest(userId, wallet, id);
    if (request.status === 'prepared') {
      const existing = this.store.prepared(request);
      if (existing.prepared.expiresAt > Date.now()) {
        return { request: this.store.workspace(userId, wallet).requests.find((item) => item.id === id)!, action: existing };
      }
      this.store.requeueExpiredPreparation(request);
    }
    if (request.status !== 'pending') throw new AppError(409, 'AGENT_REQUEST_STATE_INVALID', 'Only pending requests can be reviewed.');
    const policy = this.store.requestPolicy(request);
    try {
      assertPolicyBasics(policy, request.intent);
      const action = await this.prepare(request, policy);
      return { request: this.store.markPrepared(request, action), action };
    } catch (error) {
      const appError = asAppError(error, 'AGENT_PREPARE_FAILED');
      this.store.noteFailure(request, appError.message, !appError.retryable && appError.status < 500);
      throw appError;
    }
  }

  reject(userId: string, wallet: string, id: string) {
    return this.store.reject(this.store.ownedRequest(userId, wallet, id));
  }

  async execute(userId: string, wallet: string, id: string, signedTransaction: string, idempotencyKey: string): Promise<AgentExecutionResponse> {
    const request = this.store.ownedRequest(userId, wallet, id);
    this.store.requestPolicy(request);
    const action = this.store.prepared(request);
    try {
      const result = action.type === 'market'
        ? await this.quotes.execute(action.prepared.preparedId, signedTransaction)
        : await this.futuresTransactions.execute(action.prepared.preparedId, wallet, signedTransaction, idempotencyKey);
      const completed = this.store.complete(request, {
        signature: result.signature,
        status: result.status,
        explorerUrl: result.explorerUrl,
        provider: 'provider' in result ? result.provider : result.venue,
        completedAt: Date.now(),
      });
      return { request: completed, result };
    } catch (error) {
      const appError = asAppError(error, 'AGENT_EXECUTION_FAILED');
      this.store.noteFailure(request, appError.message, false);
      throw appError;
    }
  }

  async completeSponsored(userId: string, wallet: string, id: string, signature: string): Promise<AgentExecutionResponse> {
    const request = this.store.ownedRequest(userId, wallet, id);
    this.store.requestPolicy(request);
    const action = this.store.prepared(request);
    if (action.type !== 'market') throw new AppError(409, 'AGENT_SPONSORED_MISMATCH', 'This is not a sponsored market action.');
    try {
      const result = await this.quotes.completePrivySponsored(action.prepared.preparedId, signature);
      const completed = this.store.complete(request, {
        signature: result.signature,
        status: result.status,
        explorerUrl: result.explorerUrl,
        provider: result.provider,
        completedAt: Date.now(),
      });
      return { request: completed, result };
    } catch (error) {
      const appError = asAppError(error, 'AGENT_EXECUTION_FAILED');
      this.store.noteFailure(request, appError.message, false);
      throw appError;
    }
  }

  private async riskMicroUsd(credential: AgentCredentialRecord, policy: AgentPolicyInput, intent: AgentIntent): Promise<bigint> {
    if (intent.kind === 'convert') {
      const token = await this.tokens.getByMint(intent.inputMint);
      if (!token.verified || !token.tradable || token.usdPrice === null) throw new AppError(409, 'AGENT_PRICE_UNAVAILABLE', 'The input token needs a verified live USD price before an agent can request it.', true);
      const atomic = BigInt(intent.amountAtomic);
      const priceMicro = usdToMicro(token.usdPrice);
      return (atomic * priceMicro + (10n ** BigInt(token.decimals) - 1n)) / (10n ** BigInt(token.decimals));
    }
    if (intent.kind === 'stock') {
      const asset = await this.stocks.detail(intent.symbol);
      if (!asset.supportsAtomicSwaps || !asset.token || !asset.multiplier) throw new AppError(409, 'AGENT_STOCK_UNAVAILABLE', 'This xStock is not currently executable.', true);
      if (intent.side === 'buy') return BigInt(decimalToAtomic(intent.amount, 6));
      if (!asset.referencePrice) throw new AppError(409, 'AGENT_PRICE_UNAVAILABLE', 'A live xStock reference price is required for the guardrail check.', true);
      const amount = Number(intent.amount);
      const price = Number(asset.referencePrice);
      if (!Number.isFinite(amount) || !Number.isFinite(price)) throw new AppError(400, 'AGENT_VALUE_INVALID', 'The stock request value is invalid.');
      return usdToMicro(amount * price);
    }
    if (intent.kind === 'futures-open') {
      const portfolio = await this.futures.portfolio(credential.wallet);
      const openPositions = portfolio.venues.phoenix.positions.length + portfolio.venues.gmtrade.positions.length;
      if (openPositions >= policy.maxOpenFuturesPositions) throw new AppError(403, 'AGENT_POSITION_LIMIT', `This wallet already has the allowed ${policy.maxOpenFuturesPositions} open futures positions.`);
      return BigInt(intent.collateralAtomic);
    }
    return 0n;
  }

  private async prepare(request: AgentRequestRecord, policy: AgentPolicyInput) {
    const intent = request.intent;
    if (intent.kind === 'convert') {
      const response = await this.quotes.quotes({
        inputMint: intent.inputMint,
        outputMint: intent.outputMint,
        amount: intent.amountAtomic,
        slippageBps: intent.slippageBps,
      });
      const quote = response.quotes.find((item) => item.id === response.bestQuoteId) ?? response.quotes[0];
      if (!quote) throw new AppError(409, 'AGENT_NO_ROUTE', 'No executable Convert route is currently available.', true);
      return { type: 'market' as const, prepared: await this.quotes.prepare(quote.id, request.wallet) };
    }
    if (intent.kind === 'stock') {
      const response = await this.stocks.quote({ wallet: request.wallet, symbol: intent.symbol, side: intent.side, amount: intent.amount, slippageBps: intent.slippageBps });
      const quote = response.quoteResponse.quotes.find((item) => item.id === response.quoteResponse.bestQuoteId) ?? response.quoteResponse.quotes[0];
      if (!quote) throw new AppError(409, 'AGENT_NO_ROUTE', 'No executable xStocks route is currently available.', true);
      return { type: 'market' as const, prepared: await this.quotes.prepare(quote.id, request.wallet) };
    }
    if (intent.kind === 'futures-open') {
      const portfolio = await this.futures.portfolio(request.wallet);
      const openPositions = portfolio.venues.phoenix.positions.length + portfolio.venues.gmtrade.positions.length;
      if (openPositions >= policy.maxOpenFuturesPositions) throw new AppError(403, 'AGENT_POSITION_LIMIT', `This wallet already has the allowed ${policy.maxOpenFuturesPositions} open futures positions.`);
      const routeIntent: FuturesIntent = {
        wallet: request.wallet,
        market: intent.market,
        side: intent.side,
        orderType: intent.orderType,
        collateralAtomic: intent.collateralAtomic,
        leverageBps: intent.leverageBps,
        limitPriceMicroUsd: intent.limitPriceMicroUsd,
        slippageBps: intent.slippageBps,
        routeChoice: intent.routeChoice,
      };
      const response = await this.futures.routeQuotes(routeIntent);
      const quote = this.selectFuturesQuote(response.quotes, response.recommendedVenue, intent.routeChoice);
      if (!quote?.executionEligible) throw new AppError(409, 'AGENT_NO_ROUTE', quote?.exclusionReason ?? 'No executable Futures route is currently available.', true);
      return {
        type: 'futures' as const,
        prepared: await this.futuresTransactions.prepare({
          wallet: request.wallet,
          action: 'open',
          venue: quote.venue,
          quoteId: quote.id,
          market: quote.market,
          idempotencyKey: request.id,
        }),
      };
    }
    const portfolio = await this.futures.portfolio(request.wallet);
    const venue = portfolio.venues[intent.venue];
    const exists = intent.action === 'close'
      ? venue.positions.some((position) => position.nativeId === intent.nativeId && position.market === intent.market)
      : venue.orders.some((order) => order.nativeId === intent.nativeId && order.market === intent.market);
    if (!exists) throw new AppError(409, 'AGENT_FUTURES_TARGET_MISSING', 'The requested Futures position or order is no longer active.', true);
    return {
      type: 'futures' as const,
      prepared: await this.futuresTransactions.prepare({
        wallet: request.wallet,
        action: intent.action,
        venue: intent.venue,
        nativeId: intent.nativeId,
        market: intent.market,
        idempotencyKey: request.id,
      }),
    };
  }

  private selectFuturesQuote(quotes: FuturesRouteQuote[], recommended: 'phoenix' | 'gmtrade' | null, choice: 'auto' | 'phoenix' | 'gmtrade') {
    if (choice !== 'auto') return quotes.find((quote) => quote.venue === choice) ?? null;
    return quotes.find((quote) => quote.venue === recommended) ?? quotes.find((quote) => quote.executionEligible) ?? null;
  }
}

import { afterAll, describe, expect, it } from 'vitest';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { ComputeBudgetProgram, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { USDC_MINT } from '../../shared/constants.js';
import type { FuturesIntent, FuturesPrepareRequest } from '../../shared/futures.js';
import { withRpcFallback } from '../rpc.js';
import { GmTradeAdapter } from './gmtrade-adapter.js';
import {
  validateGmTradeInstructionAccounts,
  validateGmTradeOrderSemantics,
} from './gmtrade-transaction-validation.js';
import { PhoenixAdapter } from './phoenix-adapter.js';
import { PhoenixTransactionBuilder } from './phoenix-transactions.js';
import { validatePhoenixInstructionAccounts, validatePhoenixSemantics } from './phoenix-transaction-validation.js';
import { validateFuturesTransaction } from './transaction-service.js';

const enabled = process.env.LIVE_FUTURES_TESTS === '1';
const GMTRADE_PROGRAM = 'Gmso1uvJnLbawvw7yezdfCDcPydwW2s2iqG3w6MDucLo';
const GMTRADE_SIMULATION_WALLET = process.env.GMTRADE_TEST_WALLET ?? 'GCRJD52pGwcCSs4oswYxTBCPatxY1P6WpxCC9R9zty6r';

const gmtrade = new GmTradeAdapter();
const phoenix = new PhoenixAdapter();
afterAll(() => {
  gmtrade.close();
  phoenix.close();
});

describe.runIf(enabled)('live Futures providers', () => {
  it('loads the real two-venue market registry and every Phoenix candle interval', async () => {
    const [gmMarkets, phoenixMarkets] = await Promise.all([gmtrade.markets(), phoenix.markets()]);
    const gmSol = gmMarkets.find((market) => market.nativeSymbol === 'SOL');
    const phoenixSol = phoenixMarkets.find((market) => market.nativeSymbol === 'SOL');
    expect(gmSol).toMatchObject({ venue: 'gmtrade', active: true });
    expect(phoenixSol).toMatchObject({ venue: 'phoenix', active: true });
    expect(gmSol?.marketAddress).not.toBe(phoenixSol?.marketAddress);
    for (const interval of ['1m', '5m', '15m', '1h', '4h', '1d'] as const) {
      const result = await phoenix.candles('SOL-PERP', interval);
      expect(result.source).toBe('Phoenix external reference');
      expect(result.candles.length).toBeGreaterThan(0);
      expect(result.latestCandleAt).not.toBeNull();
    }
  }, 90_000);

  it('normalizes both live venues for the same isolated USDC intent and preserves the Phoenix onboarding gate', async () => {
    const wallet = Keypair.generate().publicKey.toBase58();
    const [gmMarkets, phoenixMarkets] = await Promise.all([gmtrade.markets(), phoenix.markets()]);
    const gmMarket = gmMarkets.find((item) => item.nativeSymbol === 'SOL');
    const phoenixMarket = phoenixMarkets.find((item) => item.nativeSymbol === 'SOL');
    expect(gmMarket).toBeDefined();
    expect(phoenixMarket).toBeDefined();
    const intent: FuturesIntent = {
      wallet,
      market: 'SOL-PERP',
      side: 'short',
      orderType: 'limit',
      collateralAtomic: '10000000',
      leverageBps: 20_000,
      limitPriceMicroUsd: phoenixMarket!.markPriceMicroUsd!,
      slippageBps: 50,
      routeChoice: 'auto',
    };
    const [gmQuote, phoenixQuote] = await Promise.all([
      gmtrade.quote(intent, gmMarket!),
      phoenix.quote(intent, phoenixMarket!),
    ]);
    for (const quote of [gmQuote, phoenixQuote]) {
      expect(quote).toMatchObject({ market: intent.market, side: intent.side, orderType: intent.orderType, collateralAtomic: intent.collateralAtomic });
      expect(BigInt(quote.entryPriceMicroUsd!)).toBeGreaterThan(0n);
      expect(BigInt(quote.baseSizeAtomic)).toBeGreaterThan(0n);
      expect(BigInt(quote.liquidationPriceMicroUsd!)).toBeGreaterThan(0n);
    }
    expect(gmQuote).toMatchObject({ venue: 'gmtrade', executionEligible: true, executionFeeLamports: '300000' });
    expect(BigInt(gmQuote.immediateCostMicroUsd!)).toBeGreaterThan(0n);
    expect(gmQuote.priceImpactBps).not.toBeNull();
    expect(gmQuote.fundingRateBpsHourly).not.toBeNull();
    expect(gmQuote.borrowingRateBpsHourly).not.toBeNull();
    expect(phoenixQuote).toMatchObject({ venue: 'phoenix', executionEligible: false, exclusionCode: 'PHOENIX_ONBOARDING_REQUIRED' });
  }, 90_000);

  it('loads authoritative live GMTrade state for an unfunded wallet', async () => {
    const startedAt = Date.now();
    const portfolio = await gmtrade.portfolio(Keypair.generate().publicKey.toBase58());
    expect(portfolio).toMatchObject({
      venue: 'gmtrade',
      available: true,
      collateralAtomic: '0',
      withdrawableAtomic: '0',
      positions: [],
      orders: [],
      orphanedConditionals: [],
    });
    expect(Array.isArray(portfolio.history)).toBe(true);
    expect(portfolio.fetchedAt).toBeGreaterThanOrEqual(startedAt);
  }, 90_000);

  it('builds, validates, and successfully simulates a real direct-USDC GMTrade order transaction', async () => {
    // This public funded address is used only as unsigned simulation state. No key is held and nothing is submitted.
    const wallet = GMTRADE_SIMULATION_WALLET;
    const walletKey = new PublicKey(wallet);
    const walletUsdc = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), walletKey, true);
    const [solBalance, usdcBalance] = await withRpcFallback((rpc) => Promise.all([
      rpc.getBalance(walletKey, 'confirmed'),
      rpc.getTokenAccountBalance(walletUsdc, 'confirmed'),
    ]));
    expect(solBalance).toBeGreaterThan(10_000_000);
    expect(BigInt(usdcBalance.value.amount)).toBeGreaterThanOrEqual(5_000_000n);
    const market = (await gmtrade.markets()).find((item) => item.nativeSymbol === 'SOL');
    expect(market).toBeDefined();
    const intent: FuturesIntent = {
      wallet,
      market: 'SOL-PERP',
      side: 'long',
      orderType: 'market',
      // GMTrade currently requires a $10 minimum SOL-PERP position. At 2x,
      // 5 USDC is the smallest live quote that satisfies that venue rule.
      collateralAtomic: '5000000',
      leverageBps: 20_000,
      slippageBps: 50,
      routeChoice: 'gmtrade',
    };
    const quote = await gmtrade.quote(intent, market!);
    expect(quote).toMatchObject({ venue: 'gmtrade', executionEligible: true, collateralAtomic: intent.collateralAtomic });
    const request: FuturesPrepareRequest = {
      wallet,
      action: 'open',
      venue: 'gmtrade',
      quoteId: quote.id,
      market: intent.market,
      idempotencyKey: crypto.randomUUID(),
    };
    const built = await gmtrade.prepareAction({ request, quote });
    const transaction = VersionedTransaction.deserialize(Buffer.from(built.transaction, 'base64'));
    const validated = await validateFuturesTransaction(
      transaction,
      wallet,
      [GMTRADE_PROGRAM],
      [wallet, quote.nativeMarketAddress, USDC_MINT],
      built.lookupTables ?? [],
    );
    const semantics = validateGmTradeOrderSemantics(request, quote, undefined, validated.instructions);
    validateGmTradeInstructionAccounts(
      request,
      quote,
      built.marketAddress ?? quote.nativeMarketAddress,
      validated.instructions,
      semantics,
    );
    expect(validated.programs).toContain(GMTRADE_PROGRAM);
    const simulation = await withRpcFallback((rpc) => rpc.simulateTransaction(transaction, { sigVerify: false, commitment: 'confirmed' }));
    expect(simulation.context.slot).toBeGreaterThan(0);
    expect(simulation.value.err).toBeNull();
  }, 90_000);

  it('builds, validates, and simulates a real Phoenix public onboarding transaction', async () => {
    const wallet = GMTRADE_SIMULATION_WALLET;
    const builder = new PhoenixTransactionBuilder();
    const lifetime = await withRpcFallback((rpc) => rpc.getLatestBlockhash('confirmed'));
    const built = await builder.build({
      wallet,
      action: 'activate',
      venue: 'phoenix',
      idempotencyKey: crypto.randomUUID(),
    }, undefined, lifetime);
    expect(built.transaction).toBeUndefined();
    expect(built.allowedAdditionalSigners).toHaveLength(1);
    const transaction = new VersionedTransaction(new TransactionMessage({
      payerKey: new PublicKey(wallet),
      recentBlockhash: lifetime.blockhash,
      instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }), ...built.instructions],
    }).compileToV0Message());
    expect(transaction.message.recentBlockhash).toBe(lifetime.blockhash);
    const validated = await validateFuturesTransaction(
      transaction,
      wallet,
      built.allowedPrograms,
      [wallet],
      [],
      built.allowedAdditionalSigners,
    );
    expect(validated.lookupTables).toEqual([]);
    validatePhoenixSemantics(built.expected, validated.instructions);
    validatePhoenixInstructionAccounts(built.expected, wallet, null, validated.instructions);
    const simulation = await withRpcFallback((rpc) => rpc.simulateTransaction(transaction, { sigVerify: false, commitment: 'confirmed' }));
    expect(simulation.context.slot).toBeGreaterThan(0);
    expect(simulation.value.err).toBeNull();
  }, 60_000);
});

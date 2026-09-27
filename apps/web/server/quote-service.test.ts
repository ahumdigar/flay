import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import type { QuoteResponse } from '../shared/types.js';
import type { QuoteSnapshot } from './domain.js';
import { EphemeralStore } from './prepared-store.js';
import { applySimulatedUserPaidCost, inferRoutePrices, QuoteService, rankQuoteSnapshots, shouldCacheQuoteResponse } from './quote-service.js';
import { TokenService } from './tokens.js';
import { assertSpendableBalance } from './balance-check.js';

const TEST_WALLET = 'So11111111111111111111111111111111111111112';

function snapshot(id: string, outAmount: string): QuoteSnapshot {
  const token = {
    mint: TEST_WALLET,
    symbol: 'SOL',
    name: 'Solana',
    decimals: 9,
    logoUri: null,
    tokenProgram: 'native' as const,
    verified: true,
    tags: [],
    extensions: [],
    tradable: true,
    blockedReason: null,
    usdPrice: null,
  };
  return {
    id,
    quote: {
      id,
      provider: 'jupiter',
      providerLabel: 'Jupiter Swap V2',
      routeLabel: 'test',
      inputMint: token.mint,
      outputMint: token.mint,
      inAmount: '1',
      outAmount,
      minimumOut: outAmount,
      slippageBps: 50,
      priceImpactPct: null,
      fees: [],
      networkFeeLamports: null,
      fetchedAt: 0,
      expiresAt: 1,
      poolIds: [],
      warnings: [],
    },
    raw: {},
    context: {},
    inputToken: token,
    outputToken: token,
  };
}

describe('quote ranking', () => {
  it('chooses the largest exact atomic output beyond safe-number precision', () => {
    const ranked = rankQuoteSnapshots([
      snapshot('lower', '9007199254740992'),
      snapshot('best', '9007199254740993'),
      snapshot('small', '10'),
    ]);
    expect(ranked.map((quote) => quote.id)).toEqual(['best', 'lower', 'small']);
  });

  it('infers a display-only SOL price from a live USDC route', () => {
    const route = snapshot('price', '500000');
    route.quote.inAmount = '5000000';
    const usdc = {
      ...route.outputToken,
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      symbol: 'USDC',
      decimals: 6,
      tokenProgram: 'spl-token' as const,
      usdPrice: 1,
    };
    const priced = inferRoutePrices(route.inputToken, usdc, route);
    expect(priced.inputToken.usdPrice).toBeCloseTo(100);
    expect(priced.outputToken.usdPrice).toBe(1);
  });

  it('does not mutate provider arrival order', () => {
    const source = [snapshot('a', '1'), snapshot('b', '2')];
    rankQuoteSnapshots(source);
    expect(source.map((quote) => quote.id)).toEqual(['a', 'b']);
  });

  it('does not cache an all-provider failure but keeps successful responses cacheable', () => {
    const failed: QuoteResponse = {
      inputToken: snapshot('input', '1').inputToken,
      outputToken: snapshot('output', '1').outputToken,
      quotes: [],
      failures: [{ provider: 'jupiter', code: 'PROVIDER_TIMEOUT', message: 'Jupiter timed out.', retryable: true }],
      bestQuoteId: null,
      requestedAt: Date.now(),
    };
    expect(shouldCacheQuoteResponse(failed)).toBe(false);
    expect(shouldCacheQuoteResponse({ ...failed, quotes: [snapshot('live', '2').quote], failures: [], bestQuoteId: 'live' })).toBe(true);
  });
});

describe('sponsored market execution boundary', () => {
  it('rejects a wallet-bound executable quote when another wallet tries to prepare it', async () => {
    const store = new EphemeralStore();
    const route = snapshot('bound', '10');
    route.quote.expiresAt = Date.now() + 15_000;
    route.quote.inputMint = route.inputToken.mint;
    route.quote.outputMint = route.outputToken.mint;
    const bound = store.putQuote({
      quote: { ...route.quote, id: '' },
      raw: {},
      context: { executionWallet: Keypair.generate().publicKey.toBase58(), jupiterMode: 'router' },
      inputToken: route.inputToken,
      outputToken: route.outputToken,
    });
    const service = new QuoteService(new TokenService(), store);

    await expect(service.prepare(bound.id, Keypair.generate().publicKey.toBase58()))
      .rejects.toMatchObject({ code: 'QUOTE_WALLET_MISMATCH', status: 403 });
  });

  it('always rejects ordinary execution for a Privy-sponsored preparation, including after submission', async () => {
    const store = new EphemeralStore();
    const prepared = store.putPrepared({
      kind: 'market-swap',
      provider: 'raydium',
      wallet: TEST_WALLET,
      unsignedMessage: new Uint8Array([1]),
      expectations: {
        kind: 'market-swap',
        provider: 'raydium',
        wallet: TEST_WALLET,
        expectedPrograms: [],
        expectedPoolIds: [],
      },
      public: {
        kind: 'market-swap',
        provider: 'raydium',
        providerLabel: 'Raydium Trade API',
        wallet: TEST_WALLET,
        transaction: 'server-produced-transaction',
        messageHash: 'hash',
        expiresAt: Date.now() + 60_000,
        gasPayment: {
          mode: 'provider-sponsored',
          provider: 'Privy',
          feePayer: null,
          signatureFeeLamports: null,
          prioritizationFeeLamports: null,
          rentFeeLamports: '0',
          detail: 'Privy pays gas.',
        },
        review: { warnings: [] },
      },
    });
    const service = new QuoteService(new TokenService(), store);

    await expect(service.execute(prepared.public.preparedId, 'invalid'))
      .rejects.toMatchObject({ code: 'PRIVY_SPONSORED_EXECUTION_REQUIRED', status: 409 });

    store.markSubmitted(prepared.public.preparedId, 'submitted-signature');
    await expect(service.execute(prepared.public.preparedId, 'invalid'))
      .rejects.toMatchObject({ code: 'PRIVY_SPONSORED_EXECUTION_REQUIRED', status: 409 });
  });
});

describe('exact simulated SOL affordability disclosure', () => {
  const userPaid = {
    mode: 'user-paid' as const,
    provider: null,
    feePayer: TEST_WALLET,
    signatureFeeLamports: '10000',
    prioritizationFeeLamports: null,
    rentFeeLamports: null,
    detail: 'Wallet paid.',
  };

  it('separates a simulated token-account rent debit from network gas', () => {
    expect(applySimulatedUserPaidCost(userPaid, -2_049_280n, '10000')).toMatchObject({
      mode: 'user-paid',
      signatureFeeLamports: '10000',
      rentFeeLamports: '2039280',
      totalWalletDebitLamports: '2049280',
      detail: expect.stringContaining('account rent'),
    });
  });

  it('does not rewrite provider-sponsored payment terms', () => {
    const sponsored = { ...userPaid, mode: 'provider-sponsored' as const, provider: 'Privy' as const };
    expect(applySimulatedUserPaidCost(sponsored, -2_049_280n, '10000')).toBe(sponsored);
  });

  it('allows exact-simulated market preparation to precheck native SOL principal without a speculative reserve', () => {
    const sol = snapshot('native-principal', '1').inputToken;
    expect(() => assertSpendableBalance(sol, '1000000', 1163493n, undefined, 0n)).not.toThrow();
    expect(() => assertSpendableBalance(sol, '1163494', 1163493n, undefined, 0n))
      .toThrowError(expect.objectContaining({ code: 'INSUFFICIENT_SOL' }));
  });
});

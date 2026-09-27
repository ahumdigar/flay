import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TokenInfo } from '../shared/types.js';
import { AppError } from './errors.js';
import { EphemeralStore } from './prepared-store.js';

const token: TokenInfo = {
  mint: 'So11111111111111111111111111111111111111112',
  symbol: 'SOL',
  name: 'Solana',
  decimals: 9,
  logoUri: null,
  tokenProgram: 'native',
  verified: true,
  tags: [],
  extensions: [],
  tradable: true,
  blockedReason: null,
  usdPrice: null,
};

afterEach(() => vi.useRealTimers());

describe('ephemeral quote and transaction binding', () => {
  it('expires quote IDs instead of rebuilding stale terms', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-14T00:00:00Z'));
    const store = new EphemeralStore();
    const stored = store.putQuote({
      quote: {
        id: '',
        provider: 'jupiter',
        providerLabel: 'Jupiter Swap V2',
        routeLabel: 'test',
        inputMint: token.mint,
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '1000000',
        outAmount: '100000',
        minimumOut: '99000',
        slippageBps: 50,
        priceImpactPct: 0,
        fees: [],
        networkFeeLamports: null,
        fetchedAt: Date.now(),
        expiresAt: Date.now() + 1_000,
        poolIds: [],
        warnings: [],
      },
      raw: {},
      context: {},
      inputToken: token,
      outputToken: { ...token, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', tokenProgram: 'spl-token' },
    });
    expect(store.getQuote(stored.id).id).toBe(stored.id);
    vi.advanceTimersByTime(1_001);
    expect(() => store.getQuote(stored.id)).toThrowError(AppError);
    try {
      store.getQuote(stored.id);
    } catch (error) {
      expect((error as AppError).code).toBe('QUOTE_EXPIRED');
    }
  });

  it('keeps an executed prepared ID idempotently addressable', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-14T00:00:00Z'));
    const store = new EphemeralStore();
    const prepared = store.putPrepared({
      kind: 'market-swap',
      provider: 'jupiter',
      wallet: token.mint,
      unsignedMessage: new Uint8Array([1, 2, 3]),
      expectations: {
        kind: 'market-swap',
        provider: 'jupiter',
        wallet: token.mint,
        expectedPrograms: [],
        expectedPoolIds: [],
      },
      public: {
        kind: 'market-swap',
        provider: 'jupiter',
        providerLabel: 'Jupiter Swap V2',
        wallet: token.mint,
        transaction: 'transaction',
        messageHash: 'hash',
        expiresAt: Date.now() + 1_000,
        review: { warnings: [] },
      },
    });
    store.markExecuted(prepared.public.preparedId, {
      signature: 'signature',
      status: 'confirmed',
      explorerUrl: 'https://explorer.solana.com/tx/signature?cluster=mainnet-beta',
      provider: 'Jupiter Swap V2',
      gasPayment: {
        mode: 'provider-sponsored',
        provider: 'Jupiter',
        feePayer: token.mint,
        signatureFeeLamports: '5000',
        prioritizationFeeLamports: null,
        rentFeeLamports: null,
        detail: 'Sponsored.',
      },
    });
    vi.advanceTimersByTime(2_000);
    expect(store.getPrepared(prepared.public.preparedId).executedSignature).toBe('signature');
    expect(store.getPrepared(prepared.public.preparedId).executionResult).toMatchObject({
      status: 'confirmed',
      gasPayment: { mode: 'provider-sponsored' },
    });
  });

  it('keeps a submitted sponsored preparation for receipt recovery and rejects a conflicting signature', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-14T00:00:00Z'));
    const store = new EphemeralStore();
    const prepared = store.putPrepared({
      kind: 'market-swap',
      provider: 'raydium',
      wallet: token.mint,
      unsignedMessage: new Uint8Array([1]),
      expectations: { kind: 'market-swap', provider: 'raydium', wallet: token.mint, expectedPrograms: [], expectedPoolIds: [] },
      public: {
        kind: 'market-swap',
        provider: 'raydium',
        providerLabel: 'Raydium Trade API',
        wallet: token.mint,
        transaction: 'transaction',
        messageHash: 'hash',
        expiresAt: Date.now() + 1_000,
        review: { warnings: [] },
      },
    });
    store.markSubmitted(prepared.public.preparedId, 'first-signature');
    vi.advanceTimersByTime(2_000);
    expect(store.getPrepared(prepared.public.preparedId).executedSignature).toBe('first-signature');
    expect(() => store.markSubmitted(prepared.public.preparedId, 'other-signature'))
      .toThrowError(expect.objectContaining({ code: 'SPONSORED_COMPLETION_CONFLICT' }));
  });
});

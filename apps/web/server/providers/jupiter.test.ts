import { Keypair } from '@solana/web3.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compactRouterFallbackMaxAccounts, JupiterAdapter, JUPITERZ_ORDER_ENGINE_PROGRAM, jupiterRoutePrograms, parseJupiterGasPayment } from './jupiter.js';
import { AppError } from '../errors.js';

const INPUT_MINT = Keypair.generate().publicKey.toBase58();
const OUTPUT_MINT = Keypair.generate().publicKey.toBase58();

afterEach(() => vi.unstubAllGlobals());

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('Jupiter gas payment classification', () => {
  it('allows the official RFQ settlement program only for JupiterZ routes', () => {
    expect(jupiterRoutePrograms('jupiterz')).toEqual([JUPITERZ_ORDER_ENGINE_PROGRAM]);
    expect(jupiterRoutePrograms('JupiterZ')).toEqual([JUPITERZ_ORDER_ENGINE_PROGRAM]);
    expect(jupiterRoutePrograms('metis')).toEqual([]);
    expect(jupiterRoutePrograms(undefined)).toEqual([]);
  });

  it('accepts explicit sponsorship only with a distinct valid signature fee payer', () => {
    const taker = Keypair.generate().publicKey.toBase58();
    const sponsor = Keypair.generate().publicKey.toBase58();
    expect(parseJupiterGasPayment({
      gasless: true,
      signatureFeePayer: sponsor,
      prioritizationFeePayer: sponsor,
      rentFeePayer: sponsor,
      signatureFeeLamports: 5_000,
      prioritizationFeeLamports: '12000',
      rentFeeLamports: 2_039_280,
    }, taker)).toEqual({
      mode: 'provider-sponsored',
      provider: 'Jupiter',
      feePayer: sponsor,
      signatureFeeLamports: '5000',
      prioritizationFeeLamports: '12000',
      rentFeeLamports: '2039280',
      detail: expect.stringContaining('quoted output'),
    });
  });

  it('classifies an ordinary taker-paid order without claiming sponsorship', () => {
    const taker = Keypair.generate().publicKey.toBase58();
    expect(parseJupiterGasPayment({ gasless: false, signatureFeePayer: taker, signatureFeeLamports: 5_000 }, taker))
      .toMatchObject({ mode: 'user-paid', provider: null, feePayer: taker, signatureFeeLamports: '5000' });
    expect(parseJupiterGasPayment({}, taker)).toMatchObject({ mode: 'user-paid', feePayer: taker });
  });

  it('fails closed on contradictory or malformed sponsorship fields', () => {
    const taker = Keypair.generate().publicKey.toBase58();
    const sponsor = Keypair.generate().publicKey.toBase58();
    for (const payload of [
      { gasless: true, signatureFeePayer: taker },
      { gasless: true, signatureFeePayer: 'not-a-public-key' },
      { gasless: false, signatureFeePayer: sponsor },
      { gasless: true, signatureFeePayer: sponsor, rentFeePayer: 'bad' },
      { gasless: true, signatureFeePayer: sponsor, signatureFeeLamports: -1 },
      { gasless: 'yes', signatureFeePayer: sponsor },
    ]) {
      expect(() => parseJupiterGasPayment(payload as never, taker))
        .toThrowError(expect.objectContaining({ code: 'JUPITER_GASLESS_INVALID' }));
    }
  });
});

describe('Jupiter wallet-bound Router quotes', () => {
  it('allows one compact route only for an exact simulation rent shortfall', () => {
    expect(compactRouterFallbackMaxAccounts(new AppError(409, 'INSUFFICIENT_SOL', 'Account rent is short.'))).toBe(20);
    expect(compactRouterFallbackMaxAccounts(new AppError(409, 'INSUFFICIENT_BALANCE', 'Token balance is short.'))).toBeNull();
    expect(compactRouterFallbackMaxAccounts(new AppError(409, 'SIMULATION_FAILED', 'Simulation failed.', true))).toBeNull();
    expect(compactRouterFallbackMaxAccounts(new Error('network failure'))).toBeNull();
  });

  it('binds build requests to the wallet, requested slippage, and compact route cap', async () => {
    const wallet = Keypair.generate().publicKey.toBase58();
    let requestedUrl = '';
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      requestedUrl = input instanceof Request ? input.url : input.toString();
      return json({ inputMint: OUTPUT_MINT, outputMint: INPUT_MINT, inAmount: '10000', outAmount: '1', otherAmountThreshold: '1' });
    }));

    await expect(new JupiterAdapter().quote({
      inputMint: INPUT_MINT,
      outputMint: OUTPUT_MINT,
      amount: '10000',
      slippageBps: 50,
      executionWallet: wallet,
      jupiterMode: 'router',
    })).rejects.toMatchObject({ code: 'JUPITER_QUOTE_INVALID' });
    const requested = new URL(requestedUrl);
    expect(requested.pathname).toBe('/swap/v2/build');
    expect(requested.searchParams.get('taker')).toBe(wallet);
    expect(requested.searchParams.get('slippageBps')).toBe('50');
    expect(requested.searchParams.get('maxAccounts')).toBe('32');
  });

  it('rejects an unexpected tip before any transaction is presented', async () => {
    const wallet = Keypair.generate().publicKey.toBase58();
    const instruction = { programId: Keypair.generate().publicKey.toBase58(), accounts: [], data: '' };
    vi.stubGlobal('fetch', vi.fn(async () => json({
      inputMint: INPUT_MINT,
      outputMint: OUTPUT_MINT,
      inAmount: '10000',
      outAmount: '10',
      otherAmountThreshold: '9',
      slippageBps: 50,
      routePlan: [],
      computeBudgetInstructions: [],
      setupInstructions: [],
      swapInstruction: instruction,
      cleanupInstruction: null,
      otherInstructions: [],
      tipInstruction: instruction,
      addressesByLookupTableAddress: null,
      blockhashWithMetadata: { blockhash: Array(32).fill(1), lastValidBlockHeight: 1 },
    })));

    await expect(new JupiterAdapter().quote({
      inputMint: INPUT_MINT,
      outputMint: OUTPUT_MINT,
      amount: '10000',
      slippageBps: 50,
      executionWallet: wallet,
      jupiterMode: 'router',
    })).rejects.toMatchObject({ code: 'JUPITER_BUILD_INVALID' });
  });
});

import { Keypair } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { SOL_MINT, USDC_MINT } from '../shared/constants.js';
import { JupiterAdapter } from './providers/jupiter.js';
import { OrcaAdapter } from './providers/orca.js';
import { RaydiumAdapter } from './providers/raydium.js';
import { validateTransactionStructure } from './transaction-validation.js';

const live = process.env.LIVE_PROVIDER_TESTS === '1';

// Opt-in because this uses public mainnet services. It never signs or submits a transaction.
describe.skipIf(!live)('live mainnet quote adapters', () => {
  it('returns independent executable quote shapes for all three providers', async () => {
    const request = {
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amount: '10000000',
      slippageBps: 50,
    };
    const jupiterAdapter = new JupiterAdapter();
    const raydiumAdapter = new RaydiumAdapter();
    const orcaAdapter = new OrcaAdapter();
    const [jupiter, raydium, orca] = await Promise.all([
      jupiterAdapter.quote(request),
      raydiumAdapter.quote(request),
      orcaAdapter.quote(request),
    ]);

    expect(jupiter.quote).toMatchObject({ provider: 'jupiter', inAmount: request.amount, inputMint: SOL_MINT, outputMint: USDC_MINT });
    expect(raydium.quote).toMatchObject({ provider: 'raydium', inAmount: request.amount, inputMint: SOL_MINT, outputMint: USDC_MINT });
    expect(orca.quote).toMatchObject({ provider: 'orca', inAmount: request.amount, inputMint: SOL_MINT, outputMint: USDC_MINT });
    for (const result of [jupiter, raydium, orca]) {
      expect(BigInt(result.quote.outAmount)).toBeGreaterThan(0n);
      expect(BigInt(result.quote.minimumOut)).toBeGreaterThan(0n);
      expect(result.quote.expiresAt).toBeGreaterThan(result.quote.fetchedAt);
    }
    expect(raydium.quote.poolIds.length).toBeGreaterThan(0);
    expect(orca.quote.poolIds.length).toBeGreaterThan(0);

    const wallet = Keypair.generate().publicKey.toBase58();
    const prepareRequest = {
      ...request,
      wallet,
      inputTokenProgram: 'native' as const,
      outputTokenProgram: 'spl-token' as const,
    };
    const [raydiumBuilt, orcaBuilt] = await Promise.all([
      raydiumAdapter.prepare(prepareRequest, raydium),
      orcaAdapter.prepare(prepareRequest, orca),
    ]);
    for (const [provider, built, quoted] of [
      ['raydium', raydiumBuilt, raydium],
      ['orca', orcaBuilt, orca],
    ] as const) {
      expect(built.transaction.version).toBe(0);
      expect(built.transactionBase64.length).toBeGreaterThan(100);
      expect(built.expectedPoolIds.length).toBeGreaterThan(0);
      const validated = await validateTransactionStructure(built.transaction, {
        kind: 'market-swap',
        provider,
        wallet,
        inputToken: {
          mint: SOL_MINT, symbol: 'SOL', name: 'Solana', decimals: 9, logoUri: null,
          tokenProgram: 'native', verified: true, tags: [], extensions: [], tradable: true,
          blockedReason: null, usdPrice: null,
        },
        outputToken: {
          mint: USDC_MINT, symbol: 'USDC', name: 'USD Coin', decimals: 6, logoUri: null,
          tokenProgram: 'spl-token', verified: true, tags: [], extensions: [], tradable: true,
          blockedReason: null, usdPrice: null,
        },
        inputAmount: request.amount,
        minimumOutput: (built.finalQuote ?? quoted.quote).minimumOut,
        expectedPrograms: built.expectedPrograms,
        expectedPoolIds: built.expectedPoolIds,
      });
      expect(validated.messageHash).toMatch(/^[a-f0-9]{64}$/);
    }
  }, 60_000);
});

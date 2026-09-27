import { Keypair } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { gaslessUsdcSendPrepareSchema, gaslessUsdcSendStatusSchema } from './schemas.js';

describe('gasless USDC send request contracts', () => {
  const wallet = Keypair.generate().publicKey.toBase58();
  const recipient = Keypair.generate().publicKey.toBase58();

  it('accepts only canonical distinct wallets and positive atomic integers', () => {
    expect(gaslessUsdcSendPrepareSchema.safeParse({ wallet, recipient, amountAtomic: '1' }).success).toBe(true);
    for (const amountAtomic of ['0', '-1', '1.1', '1e6', '', '18446744073709551616']) {
      expect(gaslessUsdcSendPrepareSchema.safeParse({ wallet, recipient, amountAtomic }).success).toBe(false);
    }
    expect(gaslessUsdcSendPrepareSchema.safeParse({ wallet, recipient: wallet, amountAtomic: '1' }).success).toBe(false);
    expect(gaslessUsdcSendPrepareSchema.safeParse({ wallet, recipient: 'not-a-wallet', amountAtomic: '1' }).success).toBe(false);
  });

  it('requires a canonical public transaction signature for status checks', () => {
    expect(gaslessUsdcSendStatusSchema.safeParse({ wallet, recipient, amountAtomic: '1', signature: '2'.repeat(88) }).success).toBe(true);
    expect(gaslessUsdcSendStatusSchema.safeParse({ wallet, recipient, amountAtomic: '1', signature: '0'.repeat(88) }).success).toBe(false);
    expect(gaslessUsdcSendStatusSchema.safeParse({ wallet, recipient, amountAtomic: '1', signature: '2'.repeat(20) }).success).toBe(false);
  });
});

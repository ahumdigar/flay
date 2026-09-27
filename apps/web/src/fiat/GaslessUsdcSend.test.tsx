import { Keypair } from '@solana/web3.js';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { GaslessUsdcSendPrepared } from '../../shared/types.js';
import { GaslessUsdcReview, normalizeUsdcSendAmount, parseStoredGaslessSends, sponsorshipError } from './GaslessUsdcSend.js';

describe('gasless USDC send interface', () => {
  it('normalizes six-decimal USDC input and discards unsafe stored rows', () => {
    expect(normalizeUsdcSendAmount('123.456789')).toBe('123.456789');
    expect(normalizeUsdcSendAmount('1,000')).toBeNull();
    expect(normalizeUsdcSendAmount('1e6')).toBeNull();
    expect(normalizeUsdcSendAmount('1.0000001')).toBeNull();
    const wallet = Keypair.generate().publicKey.toBase58();
    const recipient = Keypair.generate().publicKey.toBase58();
    const signature = '2'.repeat(88);
    const rows = parseStoredGaslessSends(JSON.stringify([
      { wallet, recipient, signature, amountAtomic: '1000', createdAt: 1, status: 'pending', transaction: 'secret' },
      { wallet: recipient, recipient, signature, amountAtomic: '1000', createdAt: 1, status: 'confirmed' },
      { wallet, recipient: 'bad', signature, amountAtomic: '1000', createdAt: 1, status: 'pending' },
    ]), wallet);
    expect(rows).toEqual([{ wallet, recipient, signature, amountAtomic: '1000', createdAt: 1, status: 'pending' }]);
    expect(JSON.stringify(rows)).not.toContain('transaction');
  });

  it('shows exact recipient, sponsorship, fee, and no-fallback disclosure in review', () => {
    const wallet = Keypair.generate().publicKey.toBase58();
    const recipient = Keypair.generate().publicKey.toBase58();
    const prepared: GaslessUsdcSendPrepared = {
      preparedId: crypto.randomUUID(),
      wallet,
      recipient,
      recipientAta: Keypair.generate().publicKey.toBase58(),
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      symbol: 'USDC',
      decimals: 6,
      amountAtomic: '1250000',
      amountUi: '1.25',
      transaction: 'encoded',
      messageHash: 'a'.repeat(64),
      expiresAt: Date.now() + 60_000,
      gasPayment: { mode: 'provider-sponsored', provider: 'Privy', detail: 'Privy pays gas.' },
      review: { flayFeePercent: '0', recipientAccountExists: true, warnings: ['Existing USDC account only.'] },
    };
    const html = renderToString(<GaslessUsdcReview prepared={prepared} busy={false} error={null} onClose={() => undefined} onApprove={() => undefined} />).replaceAll('<!-- -->', '');
    expect(html).toContain(recipient);
    expect(html).toContain('1.25 USDC');
    expect(html).toContain('Sponsored by Privy');
    expect(html).toContain('0%');
    expect(html).toContain('No SOL network gas required.');
    expect(html).toContain('no wallet-paid fallback');
  });

  it('keeps rejection errors readable and makes sponsorship setup errors actionable', () => {
    expect(sponsorshipError(new Error('User rejected the request'))).toBe('The wallet signature was rejected. Nothing was submitted.');
    expect(sponsorshipError(new Error('Gas sponsorship credits exhausted'))).toContain('Check Privy Fee sponsorship credits');
  });
});

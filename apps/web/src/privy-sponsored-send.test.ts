import { describe, expect, it } from 'vitest';
import { PRIVY_SPONSORED_SEND_CHAIN, PRIVY_SPONSORED_SEND_OPTIONS, privySponsoredMarketOptions, requirePrivySolanaSignature } from './privy-sponsored-send.js';

describe('Privy sponsored Solana send configuration', () => {
  it('requires sponsorship, mainnet, visible approval, simulation, and confirmed broadcast behavior', () => {
    expect(PRIVY_SPONSORED_SEND_CHAIN).toBe('solana:mainnet');
    expect(PRIVY_SPONSORED_SEND_OPTIONS).toMatchObject({
      sponsor: true,
      optimisticBroadcast: false,
      skipSimulation: false,
      uiOptions: {
        showWalletUIs: true,
        buttonText: 'Approve gasless send',
        isCancellable: true,
      },
    });
  });

  it('accepts only a 64-byte public Solana transaction signature', () => {
    const signature = new Uint8Array(64);
    expect(requirePrivySolanaSignature(signature)).toBe(signature);
    expect(() => requirePrivySolanaSignature(new Uint8Array(63))).toThrow(/invalid Solana transaction signature/i);
    expect(() => requirePrivySolanaSignature('signature')).toThrow(/invalid Solana transaction signature/i);
  });

  it('keeps direct venue sponsorship simulated, confirmed, and visibly wallet-approved', () => {
    expect(privySponsoredMarketOptions('Raydium')).toMatchObject({
      sponsor: true,
      optimisticBroadcast: false,
      skipSimulation: false,
      uiOptions: {
        showWalletUIs: true,
        title: 'Approve Raydium conversion',
        buttonText: 'Approve gasless conversion',
        isCancellable: true,
      },
    });
  });
});

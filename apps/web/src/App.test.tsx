import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import App, { activityGasPaymentLabel, MagicBlockModal, ReviewModal } from './App.js';
import { unconfiguredAuth } from './auth.js';
import type { PreparedTransaction, TokenInfo } from '../shared/types.js';

const sol: TokenInfo = {
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

function preparedMarket(): PreparedTransaction {
  return {
    preparedId: 'prepared',
    kind: 'market-swap',
    provider: 'jupiter',
    providerLabel: 'Jupiter Swap V2',
    wallet: sol.mint,
    transaction: 'transaction',
    messageHash: 'a'.repeat(64),
    expiresAt: Date.now() + 60_000,
    review: {
      inputToken: sol,
      outputToken: { ...sol, symbol: 'USDC', decimals: 6, tokenProgram: 'spl-token' },
      inputAmount: '100000000',
      expectedOutput: '10000000',
      minimumOutput: '9900000',
      networkFeeLamports: '6000',
      warnings: [],
    },
  };
}

describe('public Convert shell', () => {
  it('records truthful sponsorship labels for Activity', () => {
    expect(activityGasPaymentLabel({ mode: 'provider-sponsored', provider: 'Privy' })).toBe('Gas sponsored by Privy');
    expect(activityGasPaymentLabel({ mode: 'provider-sponsored', provider: 'Jupiter' })).toBe('Gas sponsored by Jupiter');
    expect(activityGasPaymentLabel({ mode: 'user-paid', provider: null })).toBe('Network gas paid by wallet');
  });

  it('renders a truthful live-app shell without Privy credentials', () => {
    const html = renderToString(<App auth={unconfiguredAuth} />);
    expect(html).toContain('Convert,');
    expect(html).toContain('Privy setup required for signing');
    expect(html).toContain('Jupiter, Raydium &amp; Orca');
    expect(html).toContain('Add funds');
    expect(html).toContain('Stocks');
    expect(html).toContain('PROVIDER BOUNDARIES');
    expect(html).toContain('Gas sponsorship eligibility is verified on the exact review.');
    expect(html).not.toContain('illustrative static rates');
  });

  it('pauses MagicBlock unlock when the provider returns mock authorization', () => {
    const html = renderToString(<MagicBlockModal
      wallet={sol.mint}
      baseBalances={null}
      status={{
        available: false,
        cluster: 'mainnet',
        token: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6 },
        mintInitialized: true,
        privateTransfers: false,
        teeAttested: true,
        authorizationMode: 'mock',
        detail: 'MagicBlock mainnet is returning mock authorization.',
        checkedAt: Date.now(),
        provider: 'MagicBlock Ephemeral SPL Token',
      }}
      balance={null}
      unlocked={false}
      busy={false}
      error={null}
      onClose={() => undefined}
      onUnlock={() => undefined}
      onRefresh={() => undefined}
      onPrepare={() => undefined}
    />);
    expect(html).toContain('MagicBlock private access is paused');
    expect(html).toContain('Private PER access is not live');
    expect(html).toContain('mock authorization');
    expect(html).not.toContain('Unlock protected balance');
  });

  it('identifies a stalled MagicBlock unlock stage and promises bounded recovery', () => {
    const html = renderToString(<MagicBlockModal
      wallet={sol.mint}
      baseBalances={null}
      status={{
        available: true,
        cluster: 'mainnet',
        token: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6 },
        mintInitialized: true,
        privateTransfers: true,
        teeAttested: true,
        authorizationMode: 'verified',
        detail: 'MagicBlock mainnet TEE attestation and wallet authorization are verified.',
        checkedAt: Date.now(),
        provider: 'MagicBlock Ephemeral SPL Token',
      }}
      balance={null}
      unlocked={false}
      busy
      unlockStage="signing-wallet"
      error={null}
      onClose={() => undefined}
      onUnlock={() => undefined}
      onRefresh={() => undefined}
      onPrepare={() => undefined}
    />);
    expect(html).toContain('Signing securely with your Privy wallet');
    expect(html).toContain('privy-signing-underlay');
    expect(html).toContain('Flay cannot intercept its controls');
  });

  it('shows a non-secret receipt after live MagicBlock authorization succeeds', () => {
    const html = renderToString(<MagicBlockModal
      wallet={sol.mint}
      baseBalances={null}
      status={{
        available: true,
        cluster: 'mainnet',
        token: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6 },
        mintInitialized: true,
        privateTransfers: true,
        teeAttested: true,
        authorizationMode: 'verified',
        detail: 'MagicBlock mainnet TEE attestation and wallet authorization are verified.',
        checkedAt: Date.now(),
        provider: 'MagicBlock Ephemeral SPL Token',
      }}
      balance={{
        wallet: sol.mint,
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        symbol: 'USDC',
        decimals: 6,
        amountAtomic: '0',
        uiAmount: '0',
        location: 'ephemeral',
        protected: true,
        unlockedUntil: Date.now() + 600_000,
        fetchedAt: Date.now(),
        authorization: {
          source: 'MagicBlock mainnet TEE',
          walletSignature: 'verified',
          teeAttestation: 'verified',
          providerToken: 'accepted',
          receiptFingerprint: 'a1b2c3d4e5f60718293a4b5c',
          authorizedAt: Date.now(),
          expiresAt: Date.now() + 600_000,
        },
      }}
      unlocked
      busy={false}
      error={null}
      onClose={() => undefined}
      onUnlock={() => undefined}
      onRefresh={() => undefined}
      onPrepare={() => undefined}
    />);
    expect(html).toContain('TEE authorization verified');
    expect(html).toContain('MagicBlock mainnet TEE');
    expect(html).toContain('a1b2c3d4e5f60718293a4b5c');
    expect(html).toContain('no bearer token exposed');
  });

  it('shows verified Jupiter sponsorship without promising it for other orders', () => {
    const prepared: PreparedTransaction = {
      ...preparedMarket(),
      gasPayment: {
        mode: 'provider-sponsored',
        provider: 'Jupiter',
        feePayer: 'gasTzr94Pmp4Gf8vknQnqxeYxdgwFjbgdJa4msYRpnB',
        signatureFeeLamports: '5000',
        prioritizationFeeLamports: '1000',
        rentFeeLamports: null,
        detail: 'Jupiter pays this order’s network gas. The quoted output already reflects any sponsorship recovery charged by Jupiter.',
      },
    };
    const html = renderToString(<ReviewModal prepared={prepared} busy={false} error={null} onClose={() => undefined} onSubmit={() => undefined} />);
    expect(html).toContain('Sponsored by Jupiter');
    expect(html).toContain('No SOL network gas required for this order.');
    expect(html).toContain('Sign gasless swap');
    expect(html).toContain('quoted output already reflects');
  });

  it('keeps an ineligible Jupiter order visibly user-paid', () => {
    const prepared: PreparedTransaction = {
      ...preparedMarket(),
      gasPayment: {
        mode: 'user-paid',
        provider: null,
        feePayer: sol.mint,
        signatureFeeLamports: '5000',
        prioritizationFeeLamports: null,
        rentFeeLamports: null,
        detail: 'Your wallet pays this order’s Solana network gas.',
      },
    };
    const html = renderToString(<ReviewModal prepared={prepared} busy={false} error={null} onClose={() => undefined} onSubmit={() => undefined} />);
    expect(html).toContain('0.000006 SOL · paid by wallet');
    expect(html).toContain('Sign this exact transaction');
    expect(html).not.toContain('Sponsored by Jupiter');
    expect(html).not.toContain('Sign gasless swap');
  });

  it('shows the exact simulated total and account rent for an affordable user-paid setup transaction', () => {
    const prepared: PreparedTransaction = {
      ...preparedMarket(),
      gasPayment: {
        mode: 'user-paid',
        provider: null,
        feePayer: sol.mint,
        signatureFeeLamports: '10000',
        prioritizationFeeLamports: null,
        rentFeeLamports: '2039280',
        totalWalletDebitLamports: '2049280',
        detail: 'Your wallet pays the exact simulated network fee and account rent.',
      },
    };
    const html = renderToString(<ReviewModal prepared={prepared} busy={false} error={null} onClose={() => undefined} onSubmit={() => undefined} />);
    expect(html).toContain('0.00204928 SOL total · paid by wallet');
    expect(html).toContain('Account rent / required SOL');
    expect(html).toContain('0.00203928');
  });

  it('shows Privy sponsorship for an eligible direct venue without inventing its payer address', () => {
    const prepared: PreparedTransaction = {
      ...preparedMarket(),
      provider: 'raydium',
      providerLabel: 'Raydium Trade API',
      gasPayment: {
        mode: 'provider-sponsored',
        provider: 'Privy',
        feePayer: null,
        signatureFeeLamports: '5000',
        prioritizationFeeLamports: null,
        rentFeeLamports: '0',
        detail: 'Privy supplies a managed Solana fee payer.',
      },
    };
    const html = renderToString(<ReviewModal prepared={prepared} busy={false} error={null} onClose={() => undefined} onSubmit={() => undefined} />);
    expect(html).toContain('Sponsored by Privy');
    expect(html).toContain('Assigned by Privy at broadcast');
    expect(html).toContain('Sign gasless swap');
    expect(html).toContain('Flay then verifies its venue');
  });

  it('turns a submitted sponsored review into confirmation recovery without requiring a fresh signature', () => {
    const prepared: PreparedTransaction = {
      ...preparedMarket(),
      provider: 'orca',
      providerLabel: 'Orca Whirlpools SDK',
      expiresAt: Date.now() - 1,
      gasPayment: {
        mode: 'provider-sponsored',
        provider: 'Privy',
        feePayer: null,
        signatureFeeLamports: '5000',
        prioritizationFeeLamports: null,
        rentFeeLamports: '0',
        detail: 'Privy supplies a managed Solana fee payer.',
      },
    };
    const html = renderToString(<ReviewModal prepared={prepared} busy={false} error="Receipt pending" sponsoredSubmitted onClose={() => undefined} onSubmit={() => undefined} />);
    expect(html).toContain('Verify sponsored transaction');
    expect(html).not.toContain('Sign gasless swap');
    expect(html).not.toContain('disabled=""');
  });

  it('renders stock review amounts with the quote multiplier instead of raw token units', () => {
    const stockMint = 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp';
    const prepared: PreparedTransaction = {
      ...preparedMarket(),
      review: {
        ...preparedMarket().review,
        outputToken: { ...sol, mint: stockMint, symbol: 'AAPLx', name: 'Apple xStock', decimals: 8, tokenProgram: 'token-2022' },
        inputAmount: '580000',
        expectedOutput: '171912',
        minimumOutput: '171052',
        stock: {
          side: 'buy',
          symbol: 'AAPLx',
          underlyingSymbol: 'AAPL',
          mint: stockMint,
          multiplier: { value: '1.0032690125398187', fetchedAt: Date.now(), nextValue: null, nextActivationAt: null, reason: null },
          requestedDisplayAmount: '0.58',
          normalizedInputDisplay: '0.58',
          expectedOutputDisplay: '0.001724739824',
          minimumOutputDisplay: '0.001716111711',
          referencePrice: '336.645',
          referencePriceFetchedAt: Date.now(),
        },
      },
    };
    const html = renderToString(<ReviewModal prepared={prepared} busy={false} error={null} onClose={() => undefined} onSubmit={() => undefined} />);
    expect(html).toContain('Review stock purchase');
    expect(html).toContain('0.001724739824');
    expect(html).toContain('0.001716111711');
    expect(html).toContain('Scaled UI multiplier');
    expect(html).toContain('1.0032690125398187');
  });
});

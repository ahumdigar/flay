export const PRIVY_SPONSORED_SEND_CHAIN = 'solana:mainnet' as const;

export const PRIVY_SPONSORED_SEND_OPTIONS = {
  sponsor: true,
  optimisticBroadcast: false,
  skipSimulation: false,
  uiOptions: {
    showWalletUIs: true,
    description: 'Send the exact USDC amount and recipient reviewed in Flay. Privy pays the Solana network fee.',
    buttonText: 'Approve gasless send',
    successHeader: 'USDC send submitted',
    successDescription: 'Flay will verify confirmation on Solana.',
    isCancellable: true,
  },
} as const;

export function privySponsoredMarketOptions(venue: 'Raydium' | 'Orca') {
  return {
    sponsor: true,
    optimisticBroadcast: false,
    skipSimulation: false,
    uiOptions: {
      showWalletUIs: true,
      title: `Approve ${venue} conversion`,
      description: `Sign the exact ${venue} conversion reviewed in Flay. Privy pays the Solana network gas.`,
      buttonText: 'Approve gasless conversion',
      successHeader: 'Conversion confirmed',
      successDescription: 'Flay will verify the venue, amounts, and fee payer on Solana.',
      isCancellable: true,
    },
  } as const;
}

export function requirePrivySolanaSignature(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== 64) {
    throw new Error('Privy returned an invalid Solana transaction signature.');
  }
  return value;
}

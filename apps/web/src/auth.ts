import type { PrivyOnrampEnvironment, PrivyOnrampFiat, PrivyOnrampStatus } from './privy-fiat-onramp';

export interface FlayAuth {
  configured: boolean;
  ready: boolean;
  authenticated: boolean;
  walletReady: boolean;
  walletAddress: string | null;
  identityToken: string | null;
  fiatOnrampEnvironment: PrivyOnrampEnvironment;
  login(): void;
  logout(): Promise<void>;
  exportWallet(): Promise<void>;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  signTransaction(transaction: Uint8Array): Promise<Uint8Array>;
  signAndSendSponsoredTransaction(transaction: Uint8Array): Promise<Uint8Array>;
  signAndSendSponsoredMarketTransaction(transaction: Uint8Array, venue: 'Raydium' | 'Orca'): Promise<Uint8Array>;
  fundUsdcWithFiat(input: { fiat: PrivyOnrampFiat; amount: string }): Promise<{ status: PrivyOnrampStatus }>;
}

export const unconfiguredAuth: FlayAuth = {
  configured: false,
  ready: true,
  authenticated: false,
  walletReady: false,
  walletAddress: null,
  identityToken: null,
  fiatOnrampEnvironment: 'sandbox',
  login() {
    window.dispatchEvent(new CustomEvent('flay:show-setup'));
  },
  async logout() {},
  async exportWallet() {
    throw new Error('Privy is not configured.');
  },
  async signMessage() {
    throw new Error('Privy is not configured.');
  },
  async signTransaction() {
    throw new Error('Privy is not configured.');
  },
  async signAndSendSponsoredTransaction() {
    throw new Error('Privy is not configured.');
  },
  async signAndSendSponsoredMarketTransaction() {
    throw new Error('Privy is not configured.');
  },
  async fundUsdcWithFiat() {
    throw new Error('Privy is not configured.');
  },
};

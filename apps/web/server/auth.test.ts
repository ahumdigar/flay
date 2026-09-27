import { describe, expect, it } from 'vitest';
import { embeddedSolanaAddresses } from './auth.js';

describe('Privy embedded wallet identity', () => {
  it('accepts both supported embedded Solana wallet client types', () => {
    expect(embeddedSolanaAddresses([
      { type: 'wallet', chain_type: 'solana', wallet_client_type: 'privy', connector_type: 'embedded', address: 'wallet-one' },
      { type: 'wallet', chain_type: 'solana', wallet_client_type: 'privy-v2', connector_type: 'embedded', address: 'wallet-two', user_can_sign: true },
    ])).toEqual(['wallet-one', 'wallet-two']);
  });

  it('excludes external, EVM, and non-signing accounts', () => {
    expect(embeddedSolanaAddresses([
      { type: 'wallet', chain_type: 'solana', wallet_client_type: 'phantom', connector_type: 'external', address: 'external' },
      { type: 'wallet', chain_type: 'ethereum', wallet_client_type: 'privy', connector_type: 'embedded', address: 'evm' },
      { type: 'wallet', chain_type: 'solana', wallet_client_type: 'privy-v2', connector_type: 'embedded', address: 'blocked', user_can_sign: false },
      { type: 'email', address: 'mail@example.com' },
    ])).toEqual([]);
  });
});

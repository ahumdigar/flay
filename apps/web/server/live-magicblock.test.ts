import { createPrivateKey, sign as nodeSign } from 'node:crypto';
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import { verifyTeeIntegrity } from '@magicblock-labs/ephemeral-rollups-sdk';
import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';
import { USDC_MINT } from '../shared/constants.js';

const enabled = process.env.LIVE_PROVIDER_TESTS === '1';
const paymentsBase = 'https://payments.magicblock.app';
const teeBase = 'https://mainnet-tee.magicblock.app';

async function apiAt<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(path, base), {
    ...init,
    headers: {
      accept: 'application/json',
      'user-agent': 'Flay-Live-Verification/0.1',
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

const api = <T>(path: string, init?: RequestInit) => apiAt<T>(paymentsBase, path, init);
const teeApi = <T>(path: string, init?: RequestInit) => apiAt<T>(teeBase, path, init);

function signChallenge(wallet: Keypair, challenge: string): string {
  const der = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(wallet.secretKey.slice(0, 32)),
  ]);
  const privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  return bs58.encode(nodeSign(null, Buffer.from(challenge, 'utf8'), privateKey));
}

interface Builder {
  kind: 'deposit' | 'transfer' | 'withdraw';
  transactionBase64: string;
  sendTo: 'base' | 'ephemeral';
  requiredSigners: string[];
  instructionCount: number;
}

describe.skipIf(!enabled)('live MagicBlock builders', () => {
  it('returns authentic mainnet USDC deposit, private PER, and withdrawal transactions without submitting', async () => {
    const wallet = Keypair.generate();
    const recipient = Keypair.generate().publicKey.toBase58();
    const address = wallet.publicKey.toBase58();

    await expect(verifyTeeIntegrity(teeBase)).resolves.toBeUndefined();

    const [health, mint] = await Promise.all([
      api<{ status: string }>('/health'),
      api<{ initialized: boolean }>(`/v1/spl/is-mint-initialized?mint=${USDC_MINT}&cluster=mainnet`),
    ]);
    expect(health.status).toBe('ok');
    expect(mint.initialized).toBe(true);

    const challenge = await teeApi<{ challenge: string }>(`/auth/challenge?pubkey=${address}`);
    expect(challenge.challenge).not.toMatch(/^\s*MOCK\s*:/i);

    const invalidLogin = await fetch(new URL('/auth/login', teeBase), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pubkey: address,
        challenge: challenge.challenge,
        signature: signChallenge(wallet, `${challenge.challenge} altered`),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    expect(invalidLogin.status).toBe(401);

    const login = await teeApi<{ token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        pubkey: address,
        challenge: challenge.challenge,
        signature: signChallenge(wallet, challenge.challenge),
      }),
    });
    expect(login.token.length).toBeGreaterThan(8);
    const authorization = { authorization: `Bearer ${login.token}` };

    const privateBalance = await api<{ address: string; mint: string; location: string; balance: string }>(
      `/v1/spl/private-balance?address=${address}&mint=${USDC_MINT}&cluster=mainnet`,
      { headers: authorization },
    );
    expect(privateBalance).toMatchObject({
      address,
      mint: USDC_MINT,
      location: 'ephemeral',
      balance: '0',
    });

    const shared = { mint: USDC_MINT, amount: 1, cluster: 'mainnet' };
    const [deposit, privateTransfer, withdraw] = await Promise.all([
      api<Builder>('/v1/spl/deposit', {
        method: 'POST',
        headers: authorization,
        body: JSON.stringify({
          owner: address,
          ...shared,
          initIfMissing: true,
          initVaultIfMissing: true,
          initAtasIfMissing: true,
          idempotent: true,
        }),
      }),
      api<Builder>('/v1/spl/transfer', {
        method: 'POST',
        headers: authorization,
        body: JSON.stringify({
          from: address,
          to: recipient,
          ...shared,
          visibility: 'private',
          fromBalance: 'ephemeral',
          toBalance: 'ephemeral',
          exactOut: false,
          initIfMissing: true,
          initAtasIfMissing: true,
          initVaultIfMissing: false,
          minDelayMs: '0',
          maxDelayMs: '1000',
          split: 1,
        }),
      }),
      api<Builder>('/v1/spl/withdraw', {
        method: 'POST',
        headers: authorization,
        body: JSON.stringify({
          owner: address,
          ...shared,
          initIfMissing: true,
          initAtasIfMissing: true,
          idempotent: true,
        }),
      }),
    ]);

    for (const [builder, kind, sendTo] of [
      [deposit, 'deposit', 'base'],
      [privateTransfer, 'transfer', 'ephemeral'],
      [withdraw, 'withdraw', 'base'],
    ] as const) {
      expect(builder).toMatchObject({
        kind,
        sendTo,
        requiredSigners: [address],
      });
      expect(builder.instructionCount).toBeGreaterThan(0);
      const transaction = VersionedTransaction.deserialize(Buffer.from(builder.transactionBase64, 'base64'));
      expect(transaction.message.staticAccountKeys[0].toBase58()).toBe(address);
      expect(transaction.signatures).toHaveLength(1);
    }

  }, 30_000);
});

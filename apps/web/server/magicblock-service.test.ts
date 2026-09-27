import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { createPrivateKey, sign as nodeSign } from 'node:crypto';
import bs58 from 'bs58';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { USDC_MINT } from '../shared/constants.js';
import type { TokenInfo, WalletBalances } from '../shared/types.js';
import { AppError } from './errors.js';
import { MagicBlockService } from './magicblock-service.js';
import { magicBlockPrepareSchema } from './schemas.js';
import type { TokenService } from './tokens.js';

const MAGIC_TOKEN_PROGRAM = new PublicKey('SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2');
const UNKNOWN_PROGRAM = Keypair.generate().publicKey;
const USDC_TOKEN: TokenInfo = {
  mint: USDC_MINT,
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  logoUri: null,
  tokenProgram: 'spl-token',
  verified: true,
  tags: ['verified'],
  extensions: [],
  tradable: true,
  blockedReason: null,
  usdPrice: 1,
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function signChallenge(wallet: Keypair, challenge: string): string {
  const der = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(wallet.secretKey.slice(0, 32)),
  ]);
  const privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  return bs58.encode(nodeSign(null, Buffer.from(challenge, 'utf8'), privateKey));
}

function buildDeposit(wallet: Keypair, amount: bigint, programId = MAGIC_TOKEN_PROGRAM) {
  const data = Buffer.alloc(13);
  data[0] = 24;
  data.writeBigUInt64LE(amount, 5);
  const blockhash = Keypair.generate().publicKey.toBase58();
  const ata = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), wallet.publicKey);
  const transaction = new Transaction({
    feePayer: wallet.publicKey,
    blockhash,
    lastValidBlockHeight: 321,
  }).add(new TransactionInstruction({
    programId,
    keys: [
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: new PublicKey(USDC_MINT), isSigner: false, isWritable: false },
      { pubkey: ata, isSigner: false, isWritable: true },
    ],
    data,
  }));
  return {
    transaction,
    builder: {
      kind: 'deposit',
      version: 'legacy',
      transactionBase64: transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }).toString('base64'),
      sendTo: 'base',
      recentBlockhash: blockhash,
      lastValidBlockHeight: 321,
      instructionCount: 1,
      requiredSigners: [wallet.publicKey.toBase58()],
      fees: { lamports: '5000', tokens: '0' },
    },
  };
}


function buildWithdraw(wallet: Keypair, amount: bigint) {
  const data = Buffer.alloc(13);
  data[0] = 26;
  data.writeBigUInt64LE(amount, 5);
  const blockhash = Keypair.generate().publicKey.toBase58();
  const ata = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), wallet.publicKey);
  const transaction = new Transaction({
    feePayer: wallet.publicKey,
    blockhash,
    lastValidBlockHeight: 444,
  }).add(new TransactionInstruction({
    programId: MAGIC_TOKEN_PROGRAM,
    keys: [
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: new PublicKey(USDC_MINT), isSigner: false, isWritable: false },
      { pubkey: ata, isSigner: false, isWritable: true },
    ],
    data,
  }));
  return {
    transaction,
    builder: {
      kind: 'withdraw',
      version: 'legacy',
      transactionBase64: transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }).toString('base64'),
      sendTo: 'base',
      recentBlockhash: blockhash,
      lastValidBlockHeight: 444,
      instructionCount: 1,
      requiredSigners: [wallet.publicKey.toBase58()],
      fees: { lamports: '5000', tokens: '0' },
    },
  };
}

function buildPrivateTransfer(wallet: Keypair, recipient: PublicKey, amount: bigint) {
  const data = Buffer.alloc(9);
  data[0] = 3;
  data.writeBigUInt64LE(amount, 1);
  const blockhash = Keypair.generate().publicKey.toBase58();
  const sourceAta = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), wallet.publicKey);
  const recipientAta = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), recipient);
  const transaction = new Transaction({
    feePayer: wallet.publicKey,
    blockhash,
    lastValidBlockHeight: 555,
  });
  transaction.add(new TransactionInstruction({
    programId: MAGIC_TOKEN_PROGRAM,
    keys: [{ pubkey: wallet.publicKey, isSigner: true, isWritable: false }],
    data: Buffer.from([9]),
  }));
  transaction.add(new TransactionInstruction({
    programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    keys: [
      { pubkey: sourceAta, isSigner: false, isWritable: true },
      { pubkey: recipientAta, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
    ],
    data,
  }));
  return {
    transaction,
    builder: {
      kind: 'transfer',
      version: 'legacy',
      transactionBase64: transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }).toString('base64'),
      sendTo: 'ephemeral',
      recentBlockhash: blockhash,
      lastValidBlockHeight: 555,
      instructionCount: 2,
      requiredSigners: [wallet.publicKey.toBase58()],
      fees: { lamports: '0', tokens: '0' },
    },
  };
}

function fundedTokens(wallet: Keypair): TokenService {
  const balances: WalletBalances = {
    wallet: wallet.publicKey.toBase58(),
    slot: 1,
    fetchedAt: Date.now(),
    balances: [{ token: USDC_TOKEN, amountAtomic: '5000000', uiAmount: '5' }],
  };
  return { balances: vi.fn(async () => balances) } as unknown as TokenService;
}

async function unlock(service: MagicBlockService, wallet: Keypair) {
  const address = wallet.publicKey.toBase58();
  const challenge = await service.challenge(address);
  return service.login(address, challenge.challenge, signChallenge(wallet, challenge.challenge));
}

describe('MagicBlock contract-free account service', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('disables private access when the provider returns mock authorization', async () => {
    const wallet = Keypair.generate();
    globalThis.fetch = vi.fn(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/health') return json({ status: 'ok' });
      if (path === '/v1/spl/is-mint-initialized') return json({ initialized: true });
      if (path === '/auth/challenge') {
        return json({ challenge: `MOCK: Login to Query Filtering Service\nTimestamp: ${new Date().toISOString()}` });
      }
      throw new Error(`Unexpected endpoint ${path}`);
    }) as typeof fetch;

    const service = new MagicBlockService(fundedTokens(wallet), async () => undefined);
    await expect(service.status()).resolves.toMatchObject({
      available: false,
      mintInitialized: true,
      privateTransfers: false,
      teeAttested: true,
      authorizationMode: 'mock',
    });
    await expect(service.challenge(wallet.publicKey.toBase58())).rejects.toMatchObject({
      code: 'MAGICBLOCK_AUTH_MOCK',
      status: 503,
    } satisfies Partial<AppError>);
  });

  it('reports verified readiness for a non-mock provider challenge', async () => {
    const wallet = Keypair.generate();
    globalThis.fetch = vi.fn(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/health') return json({ status: 'ok' });
      if (path === '/v1/spl/is-mint-initialized') return json({ initialized: true });
      if (path === '/auth/challenge') return json({ challenge: 'Sign this verified MagicBlock mainnet authorization challenge' });
      throw new Error(`Unexpected endpoint ${path}`);
    }) as typeof fetch;

    await expect(new MagicBlockService(fundedTokens(wallet), async () => undefined).status()).resolves.toMatchObject({
      available: true,
      mintInitialized: true,
      privateTransfers: true,
      teeAttested: true,
      authorizationMode: 'verified',
    });
  });

  it('refuses a mock provider token after a valid wallet signature', async () => {
    const wallet = Keypair.generate();
    globalThis.fetch = vi.fn(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/auth/challenge') return json({ challenge: 'Sign this verified MagicBlock mainnet authorization challenge' });
      if (path === '/auth/login') return json({ token: 'mock-auth-token' });
      throw new Error(`Unexpected endpoint ${path}`);
    }) as typeof fetch;

    const service = new MagicBlockService(fundedTokens(wallet), async () => undefined);
    await expect(unlock(service, wallet)).rejects.toMatchObject({
      code: 'MAGICBLOCK_AUTH_MOCK',
      status: 503,
    } satisfies Partial<AppError>);
  });

  it('keeps the provider bearer token server-side and validates exact signed deposit bytes', async () => {
    const wallet = Keypair.generate();
    const address = wallet.publicKey.toBase58();
    const built = buildDeposit(wallet, 1_000_000n);
    const requests: Array<{ path: string; authorization: string | null; body: unknown }> = [];

    globalThis.fetch = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      requests.push({ path: url.pathname, authorization: headers.get('authorization'), body });
      if (url.pathname === '/health') return json({ status: 'ok' });
      if (url.pathname === '/v1/spl/is-mint-initialized') return json({ initialized: true });
      if (url.pathname === '/auth/challenge') return json({ challenge: 'Sign this one-time MagicBlock test challenge' });
      if (url.pathname === '/auth/login') return json({ token: 'server-only-test-bearer-token' });
      if (url.pathname === '/v1/spl/deposit') return json(built.builder);
      if (url.pathname === '/v1/transaction/send') {
        return json({
          signature: bs58.encode(Buffer.alloc(64, 7)),
          sendTo: 'base',
          confirmed: true,
          confirmationRpcEndpoint: 'https://api.mainnet-beta.solana.com',
          confirmationRequiresAuthToken: false,
        });
      }
      throw new Error(`Unexpected endpoint ${url.pathname}`);
    }) as typeof fetch;

    const service = new MagicBlockService(fundedTokens(wallet), async () => undefined);
    const login = await unlock(service, wallet);
    expect(login).toEqual({ unlocked: true, expiresAt: expect.any(Number) });
    expect(JSON.stringify(login)).not.toContain('server-only-test-bearer-token');

    const prepared = await service.prepare({
      action: 'deposit',
      wallet: address,
      amountAtomic: '1000000',
    });
    expect(prepared).toMatchObject({
      wallet: address,
      action: 'deposit',
      amountAtomic: '1000000',
      sendTo: 'base',
    });
    expect(JSON.stringify(prepared)).not.toContain('server-only-test-bearer-token');

    const transaction = Transaction.from(Buffer.from(prepared.transaction, 'base64'));
    transaction.partialSign(wallet);
    const signedTransaction = transaction.serialize().toString('base64');
    const result = await service.execute(prepared.preparedId, address, signedTransaction);

    expect(result).toMatchObject({
      confirmed: true,
      sendTo: 'base',
      networkLabel: 'Solana mainnet',
    });
    expect(result.explorerUrl).toContain(result.signature);
    expect(requests.find((request) => request.path === '/v1/spl/deposit')?.authorization)
      .toBe('Bearer server-only-test-bearer-token');
    expect(requests.find((request) => request.path === '/v1/transaction/send')?.body)
      .toMatchObject({ sendTo: 'base', cluster: 'mainnet', confirm: true });
  });


  it('exposes only private PER transfers and submits them to the private cluster', async () => {
    const wallet = Keypair.generate();
    const recipient = Keypair.generate().publicKey;
    const address = wallet.publicKey.toBase58();
    const recipientAddress = recipient.toBase58();
    const privateTransfer = buildPrivateTransfer(wallet, recipient, 100_000n);
    const withdrawal = buildWithdraw(wallet, 100_000n);
    const sends: Array<Record<string, unknown>> = [];

    globalThis.fetch = vi.fn(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/health') return json({ status: 'ok' });
      if (path === '/v1/spl/is-mint-initialized') return json({ initialized: true });
      if (path === '/auth/challenge') return json({ challenge: 'Sign this one-time MagicBlock test challenge' });
      if (path === '/auth/login') return json({ token: 'server-only-test-bearer-token' });
      if (path === '/v1/spl/private-balance') {
        return json({
          address,
          mint: USDC_MINT,
          ata: getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), wallet.publicKey).toBase58(),
          location: 'ephemeral',
          balance: '5000000',
        });
      }
      if (path === '/v1/spl/transfer') return json(privateTransfer.builder);
      if (path === '/v1/spl/withdraw') return json(withdrawal.builder);
      if (path === '/v1/transaction/send') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        sends.push(body);
        return json({
          signature: bs58.encode(Buffer.alloc(64, sends.length)),
          sendTo: body.sendTo,
          confirmed: true,
          confirmationRpcEndpoint: 'https://api.mainnet-beta.solana.com',
          confirmationRequiresAuthToken: body.sendTo === 'ephemeral',
        });
      }
      throw new Error(`Unexpected endpoint ${path}`);
    }) as typeof fetch;

    const service = new MagicBlockService(fundedTokens(wallet), async () => undefined);
    await unlock(service, wallet);
    const balance = await service.balance(address);
    expect(balance).toMatchObject({
      wallet: address,
      amountAtomic: '5000000',
      location: 'ephemeral',
      protected: true,
      authorization: {
        source: 'MagicBlock mainnet TEE',
        walletSignature: 'verified',
        teeAttestation: 'verified',
        providerToken: 'accepted',
        receiptFingerprint: expect.stringMatching(/^[a-f0-9]{24}$/),
        authorizedAt: expect.any(Number),
        expiresAt: expect.any(Number),
      },
    });
    expect(JSON.stringify(balance)).not.toContain('server-only-test-bearer-token');

    for (const request of [
      { action: 'private-transfer' as const },
      { action: 'withdraw' as const },
    ]) {
      const prepared = await service.prepare({
        action: request.action,
        wallet: address,
        amountAtomic: '100000',
        ...(request.action === 'private-transfer' ? { recipient: recipientAddress } : {}),
      });
      expect(prepared.sendTo).toBe(request.action === 'withdraw' ? 'base' : 'ephemeral');
      expect(prepared.review.mode).toContain(request.action === 'private-transfer' ? 'PER' : 'Solana');

      const transaction = Transaction.from(Buffer.from(prepared.transaction, 'base64'));
      transaction.partialSign(wallet);
      await expect(service.execute(
        prepared.preparedId,
        address,
        transaction.serialize().toString('base64'),
      )).resolves.toMatchObject({
        confirmed: true,
        sendTo: request.action === 'withdraw' ? 'base' : 'ephemeral',
      });
    }

    expect(sends.map((body) => body.cluster)).toEqual(['mainnet-private', 'mainnet']);
    expect(sends.map((body) => body.sendTo)).toEqual(['ephemeral', 'base']);
  });

  it('rejects the removed public ER action at the API schema boundary', () => {
    expect(() => magicBlockPrepareSchema.parse({
      action: 'public-transfer',
      wallet: Keypair.generate().publicKey.toBase58(),
      recipient: Keypair.generate().publicKey.toBase58(),
      amountAtomic: '1',
    })).toThrow();
  });

  it('rejects a builder transaction that invokes an unreviewed program', async () => {
    const wallet = Keypair.generate();
    const address = wallet.publicKey.toBase58();
    const built = buildDeposit(wallet, 1_000_000n, UNKNOWN_PROGRAM);

    globalThis.fetch = vi.fn(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/health') return json({ status: 'ok' });
      if (path === '/v1/spl/is-mint-initialized') return json({ initialized: true });
      if (path === '/auth/challenge') return json({ challenge: 'Sign this one-time MagicBlock test challenge' });
      if (path === '/auth/login') return json({ token: 'server-only-test-bearer-token' });
      if (path === '/v1/spl/deposit') return json(built.builder);
      throw new Error(`Unexpected endpoint ${path}`);
    }) as typeof fetch;

    const service = new MagicBlockService(fundedTokens(wallet), async () => undefined);
    await unlock(service, wallet);

    await expect(service.prepare({
      action: 'deposit',
      wallet: address,
      amountAtomic: '1000000',
    })).rejects.toMatchObject({
      code: 'MAGICBLOCK_PROGRAM_NOT_ALLOWED',
      status: 409,
    } satisfies Partial<AppError>);
  });

  it('rejects any signed transaction whose reviewed message changed', async () => {
    const wallet = Keypair.generate();
    const address = wallet.publicKey.toBase58();
    const built = buildDeposit(wallet, 1_000_000n);

    globalThis.fetch = vi.fn(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/health') return json({ status: 'ok' });
      if (path === '/v1/spl/is-mint-initialized') return json({ initialized: true });
      if (path === '/auth/challenge') return json({ challenge: 'Sign this one-time MagicBlock test challenge' });
      if (path === '/auth/login') return json({ token: 'server-only-test-bearer-token' });
      if (path === '/v1/spl/deposit') return json(built.builder);
      throw new Error(`Unexpected endpoint ${path}`);
    }) as typeof fetch;

    const service = new MagicBlockService(fundedTokens(wallet), async () => undefined);
    await unlock(service, wallet);
    const prepared = await service.prepare({
      action: 'deposit',
      wallet: address,
      amountAtomic: '1000000',
    });

    const changed = Transaction.from(Buffer.from(prepared.transaction, 'base64'));
    changed.add(new TransactionInstruction({
      programId: new PublicKey('ComputeBudget111111111111111111111111111111'),
      keys: [],
      data: Buffer.from([1]),
    }));
    changed.partialSign(wallet);

    await expect(service.execute(
      prepared.preparedId,
      address,
      changed.serialize().toString('base64'),
    )).rejects.toMatchObject({ code: 'MAGICBLOCK_TRANSACTION_CHANGED', status: 409 });
  });
});

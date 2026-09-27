import { createHmac } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Keypair } from '@solana/web3.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { USDC_MINT } from '../shared/constants.js';

const rpcFallback = vi.hoisted(() => vi.fn());
vi.mock('./rpc.js', () => ({ withRpcFallback: rpcFallback }));
import {
  AlchemyPayService,
  alchemyPaySignature,
  canonicalObject,
  canonicalQuery,
  signRampParameters,
  verifiedUsdcReceiptAtomic,
  verifyAlchemyPayWebhook,
} from './alchemy-pay-service.js';

const directories: string[] = [];
const now = 1_789_999_000_000;

beforeEach(() => {
  rpcFallback.mockReset().mockResolvedValue(null);
});

async function testService() {
  const directory = await mkdtemp(path.join(tmpdir(), 'flay-alchemy-pay-'));
  directories.push(directory);
  const orderStorePath = path.join(directory, 'orders.json');
  const options = {
    environment: 'test' as const,
    appId: 'flay_test_app',
    appSecret: 'test-secret-key',
    publicUrl: 'http://localhost:5173',
    orderStorePath,
    allowedFiat: ['USD', 'EUR'],
    minFiatAmount: '15',
    maxFiatAmount: '1000',
    clock: () => now,
  };
  return { service: new AlchemyPayService(options), options, orderStorePath };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Alchemy Pay signing and checkout policy', () => {
  it('sorts exact ramp fields and matches a fixed HMAC vector', () => {
    const parameters = {
      timestamp: '1538054050234',
      showTable: 'buy',
      network: 'SOL',
      merchantOrderNo: 'FLAYTEST123456',
      fiatAmount: '50.00',
      fiat: 'USD',
      crypto: 'USDC',
      appId: 'f83Is2y7L425rxl8',
    };
    expect(canonicalQuery({ z: '', b: '2', a: '1' })).toBe('a=1&b=2');
    expect(signRampParameters(parameters, 'test-secret-key')).toBe('xsqObU4T2v0xYFQbN/jMmhU3egNlr68o3UCBNEctLIs=');
  });

  it('creates a wallet-bound USDC/Solana URL and restores the order after restart', async () => {
    const { service, options, orderStorePath } = await testService();
    const wallet = Keypair.generate().publicKey.toBase58();
    const checkout = await service.createCheckout({ wallet, fiat: 'USD', fiatAmount: '50.00' }, 'privy-user-1');
    const url = new URL(checkout.order.checkoutUrl);
    expect(url.origin).toBe('https://ramptest.alchemypay.org');
    expect(url.searchParams.get('crypto')).toBe('USDC');
    expect(url.searchParams.get('network')).toBe('SOL');
    expect(url.searchParams.get('address')).toBe(wallet);
    expect(url.searchParams.get('fiatAmount')).toBe('50.00');
    expect(url.searchParams.get('sign')).toBeTruthy();
    const signedParameters = Object.fromEntries([...url.searchParams.entries()].filter(([key]) => key !== 'sign'));
    expect(url.searchParams.get('sign')).toBe(signRampParameters(signedParameters, options.appSecret));
    expect(checkout.order.merchantOrderNo.length).toBeLessThanOrEqual(48);

    const restarted = new AlchemyPayService({ ...options, orderStorePath });
    expect(await restarted.list(wallet, 'privy-user-1')).toHaveLength(1);
    expect(await restarted.list(wallet, 'another-user')).toHaveLength(0);
  });

  it('rejects unsupported currencies, unsafe decimals, and configured amount violations', async () => {
    const { service } = await testService();
    const wallet = Keypair.generate().publicKey.toBase58();
    await expect(service.createCheckout({ wallet, fiat: 'JPY', fiatAmount: '50.00' }, 'user')).rejects.toMatchObject({ code: 'FIAT_CURRENCY_UNSUPPORTED' });
    await expect(service.createCheckout({ wallet, fiat: 'USD', fiatAmount: '1e2' }, 'user')).rejects.toMatchObject({ code: 'FIAT_AMOUNT_INVALID' });
    await expect(service.createCheckout({ wallet, fiat: 'USD', fiatAmount: '-50.00' }, 'user')).rejects.toMatchObject({ code: 'FIAT_AMOUNT_INVALID' });
    await expect(service.createCheckout({ wallet, fiat: 'USD', fiatAmount: '50.001' }, 'user')).rejects.toMatchObject({ code: 'FIAT_AMOUNT_INVALID' });
    await expect(service.createCheckout({ wallet, fiat: 'USD', fiatAmount: '14.99' }, 'user')).rejects.toMatchObject({ code: 'FIAT_AMOUNT_OUT_OF_RANGE' });
    await expect(service.createCheckout({ wallet, fiat: 'USD', fiatAmount: '1000.01' }, 'user')).rejects.toMatchObject({ code: 'FIAT_AMOUNT_OUT_OF_RANGE' });
  });

  it('caps checkout creation per identity and wallet', async () => {
    const { service } = await testService();
    const wallet = Keypair.generate().publicKey.toBase58();
    for (let index = 0; index < 5; index += 1) {
      await service.createCheckout({ wallet, fiat: 'USD', fiatAmount: '50.00' }, 'rate-limited-user');
    }
    await expect(service.createCheckout({ wallet, fiat: 'USD', fiatAmount: '50.00' }, 'rate-limited-user')).rejects.toMatchObject({ code: 'FIAT_CHECKOUT_RATE_LIMITED' });
  });

  it('counts only USDC credited to the reviewed wallet', () => {
    const wallet = Keypair.generate().publicKey.toBase58();
    const another = Keypair.generate().publicKey.toBase58();
    const token = (owner: string, mint: string, amount: string) => ({ owner, mint, uiTokenAmount: { amount } });
    expect(verifiedUsdcReceiptAtomic(
      [token(wallet, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', '100')],
      [token(wallet, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', '1100'), token(another, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', '9000')],
      wallet,
    )).toBe(1000n);
    expect(verifiedUsdcReceiptAtomic([], [token(wallet, 'So11111111111111111111111111111111111111112', '1000')], wallet)).toBe(0n);
  });

  it('fails closed when the durable store is corrupted', async () => {
    const { service: initial, options, orderStorePath } = await testService();
    await initial.list(Keypair.generate().publicKey.toBase58(), 'user');
    await writeFile(orderStorePath, '{not-json', 'utf8');
    const service = new AlchemyPayService({ ...options, orderStorePath });
    await expect(service.list(Keypair.generate().publicKey.toBase58(), 'user')).rejects.toMatchObject({ code: 'FIAT_ORDER_STORE_UNAVAILABLE' });
  });
});

describe('Alchemy Pay webhook boundary', () => {
  it('accepts only a fresh canonical signature', () => {
    const body = { status: 'PAY_SUCCESS', newSignature: 'ignored', fiat: 'USD', empty: '' };
    const timestamp = String(now);
    const signature = alchemyPaySignature(`${timestamp}POST/api/fiat/alchemy-pay/webhook${JSON.stringify(canonicalObject(body))}`, 'test-secret-key');
    expect(verifyAlchemyPayWebhook(body, timestamp, signature, 'test-secret-key', now)).toBe(true);
    expect(verifyAlchemyPayWebhook(body, timestamp, `${signature}x`, 'test-secret-key', now)).toBe(false);
    expect(verifyAlchemyPayWebhook(body, String(now - 300_001), signature, 'test-secret-key', now)).toBe(false);
  });

  it('updates the matching order idempotently and rejects a signed field mismatch', async () => {
    const { service } = await testService();
    const wallet = Keypair.generate().publicKey.toBase58();
    const checkout = await service.createCheckout({ wallet, fiat: 'USD', fiatAmount: '50.00' }, 'user');
    const body: Record<string, unknown> = {
      address: wallet,
      amount: '50.00000000',
      appId: 'flay_test_app',
      crypto: 'USDC',
      fiat: 'USD',
      merchantOrderNo: checkout.order.merchantOrderNo,
      network: 'SOL',
      orderNo: 'ACH123456',
      status: 'PAY_SUCCESS',
    };
    const signed = (value: Record<string, unknown>) => createHmac('sha256', 'test-secret-key')
      .update(`${now}POST/api/fiat/alchemy-pay/webhook${JSON.stringify(canonicalObject(value))}`)
      .digest('base64');
    body.newSignature = signed(body);
    await service.webhook(body, String(now));
    await service.webhook(body, String(now));
    expect((await service.get(checkout.order.merchantOrderNo, wallet, 'user')).status).toBe('payment-pending');

    const altered: Record<string, unknown> = { ...body, address: Keypair.generate().publicKey.toBase58() };
    altered.newSignature = signed(altered);
    await expect(service.webhook(altered, String(now))).rejects.toMatchObject({ code: 'FIAT_PROVIDER_MISMATCH' });
    expect((await service.get(checkout.order.merchantOrderNo, wallet, 'user')).status).toBe('payment-pending');

    const stale: Record<string, unknown> = { ...body };
    stale.newSignature = createHmac('sha256', 'test-secret-key')
      .update(`${now - 300_001}POST/api/fiat/alchemy-pay/webhook${JSON.stringify(canonicalObject(stale))}`)
      .digest('base64');
    await expect(service.webhook(stale, String(now - 300_001))).rejects.toMatchObject({ code: 'ALCHEMY_PAY_WEBHOOK_INVALID' });

    const wrongApp: Record<string, unknown> = { ...body, appId: 'another_app' };
    wrongApp.newSignature = signed(wrongApp);
    await expect(service.webhook(wrongApp, String(now))).rejects.toMatchObject({ code: 'ALCHEMY_PAY_WEBHOOK_MISMATCH' });

    const unknown: Record<string, unknown> = { ...body, merchantOrderNo: 'FLAYUNKNOWN123456' };
    unknown.newSignature = signed(unknown);
    await expect(service.webhook(unknown, String(now))).rejects.toMatchObject({ code: 'FIAT_ORDER_NOT_FOUND' });

    const finishedWithoutTransaction: Record<string, unknown> = { ...body, status: 'FINISHED' };
    finishedWithoutTransaction.newSignature = signed(finishedWithoutTransaction);
    await expect(service.webhook(finishedWithoutTransaction, String(now))).rejects.toMatchObject({ code: 'ALCHEMY_PAY_WEBHOOK_MISMATCH' });
    expect((await service.get(checkout.order.merchantOrderNo, wallet, 'user')).status).toBe('payment-pending');
  });

  it('requires an onchain USDC credit and never regresses confirmed receipt', async () => {
    const { service } = await testService();
    const wallet = Keypair.generate().publicKey.toBase58();
    const checkout = await service.createCheckout({ wallet, fiat: 'USD', fiatAmount: '50.00' }, 'user');
    const sign = (value: Record<string, unknown>) => createHmac('sha256', 'test-secret-key')
      .update(`${now}POST/api/fiat/alchemy-pay/webhook${JSON.stringify(canonicalObject(value))}`)
      .digest('base64');
    const finished: Record<string, unknown> = {
      address: wallet,
      amount: '50.00000000',
      appId: 'flay_test_app',
      crypto: 'USDC',
      cryptoQuantity: '48.50',
      fiat: 'USD',
      merchantOrderNo: checkout.order.merchantOrderNo,
      network: 'SOL',
      orderNo: 'ACH-FINISHED',
      status: 'FINISHED',
      txHash: '1'.repeat(88),
    };
    finished.newSignature = sign(finished);

    await service.webhook(finished, String(now));
    expect((await service.get(checkout.order.merchantOrderNo, wallet, 'user')).status).toBe('provider-finished');

    rpcFallback.mockResolvedValue({
      meta: {
        err: null,
        preTokenBalances: [],
        postTokenBalances: [{ mint: USDC_MINT, owner: wallet, uiTokenAmount: { amount: '48500000' } }],
      },
    });
    expect((await service.get(checkout.order.merchantOrderNo, wallet, 'user')).status).toBe('confirmed');

    const latePending: Record<string, unknown> = { ...finished, status: 'PAY_SUCCESS' };
    delete latePending.txHash;
    latePending.newSignature = sign(latePending);
    await service.webhook(latePending, String(now));
    expect((await service.get(checkout.order.merchantOrderNo, wallet, 'user')).status).toBe('confirmed');
  });
});

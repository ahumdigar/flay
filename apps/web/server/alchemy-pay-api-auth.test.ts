import express from 'express';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SOL_MINT, USDC_MINT } from '../shared/constants.js';

vi.mock('@privy-io/node', () => ({
  verifyIdentityToken: vi.fn().mockResolvedValue({
    id: 'did:privy:alchemy-owner',
    linked_accounts: [{
      type: 'wallet',
      chain_type: 'solana',
      wallet_client_type: 'privy-v2',
      connector_type: 'embedded',
      user_can_sign: true,
      address: SOL_MINT,
    }],
  }),
}));

let createApiRouter: typeof import('./api.js').createApiRouter;
let directory: string;
let storePath: string;

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'flay-alchemy-api-'));
  storePath = path.join(directory, 'orders.json');
  const { config } = await import('./config.js');
  config.privyAppId = 'test-app';
  config.privyVerificationKey = 'test-verification-key';
  config.alchemyPay.environment = 'test';
  config.alchemyPay.appId = 'alchemy_test_app';
  config.alchemyPay.appSecret = 'server-only-test-secret';
  config.alchemyPay.publicUrl = 'http://localhost:5173';
  config.alchemyPay.orderStorePath = storePath;
  config.alchemyPay.allowedFiat = ['USD'];
  config.alchemyPay.minFiatAmount = '15';
  config.alchemyPay.maxFiatAmount = '1000';
  createApiRouter = (await import('./api.js')).createApiRouter;
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

function testApp() {
  const app = express();
  app.use('/api', createApiRouter());
  return app;
}

const identity = { 'x-privy-identity-token': 'valid-test-token' };

describe('identity-bound Alchemy Pay API', () => {
  it('creates and persists only a server-fixed USDC/Solana checkout', async () => {
    const app = testApp();
    const response = await request(app)
      .post('/api/fiat/checkout')
      .set(identity)
      .send({
        wallet: SOL_MINT,
        fiat: 'USD',
        fiatAmount: '50.00',
        crypto: 'SOL',
        network: 'ETH',
        address: USDC_MINT,
      })
      .expect(201);

    expect(response.body.order).toMatchObject({ wallet: SOL_MINT, crypto: 'USDC', network: 'SOL', fiatAmount: '50.00' });
    expect(JSON.stringify(response.body)).not.toContain('server-only-test-secret');
    const url = new URL(response.body.order.checkoutUrl);
    expect(url.searchParams.get('address')).toBe(SOL_MINT);
    expect(url.searchParams.get('crypto')).toBe('USDC');
    expect(url.searchParams.get('network')).toBe('SOL');

    const persisted = JSON.parse(await readFile(storePath, 'utf8')) as { orders: Array<{ merchantOrderNo: string }> };
    expect(persisted.orders.some((order) => order.merchantOrderNo === response.body.order.merchantOrderNo)).toBe(true);

    const orders = await request(app).get('/api/fiat/orders').query({ wallet: SOL_MINT }).set(identity).expect(200);
    expect(orders.body.orders.map((order: { merchantOrderNo: string }) => order.merchantOrderNo)).toContain(response.body.order.merchantOrderNo);
  });

  it('rejects every wallet address outside the authenticated Privy identity', async () => {
    const app = testApp();
    const checkout = await request(app).post('/api/fiat/checkout').set(identity).send({ wallet: USDC_MINT, fiat: 'USD', fiatAmount: '50.00' });
    expect(checkout.status).toBe(403);
    expect(checkout.body.error.code).toBe('WALLET_MISMATCH');

    const list = await request(app).get('/api/fiat/orders').query({ wallet: USDC_MINT }).set(identity);
    expect(list.status).toBe(403);
    expect(list.body.error.code).toBe('WALLET_MISMATCH');
  });
});

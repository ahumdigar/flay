import express from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SOL_MINT, USDC_MINT } from '../../shared/constants.js';

vi.mock('@privy-io/node', () => ({
  verifyIdentityToken: vi.fn().mockResolvedValue({
    id: 'did:privy:test',
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

let createApiRouter: typeof import('../api.js').createApiRouter;

beforeAll(async () => {
  const configModule = await import('../config.js');
  configModule.config.privyAppId = 'test-app';
  configModule.config.privyVerificationKey = 'test-verification-key';
  createApiRouter = (await import('../api.js')).createApiRouter;
});

function testApp() {
  const app = express();
  app.use('/api', createApiRouter());
  return app;
}

const identity = { 'x-privy-identity-token': 'valid-test-token' };
const uuid = '811ad33d-c22f-41f9-8bcd-bbb8b9a84551';
async function expectWalletMismatch(response: request.Test) {
  const result = await response.set(identity);
  expect(result.status).toBe(403);
  expect(result.body.error.code).toBe('WALLET_MISMATCH');
}

describe('identity-bound Futures API', () => {
  it('rejects a different wallet on every authenticated Futures endpoint', async () => {
    const app = testApp();
    await expectWalletMismatch(request(app).post('/api/futures/quotes').send({
      wallet: USDC_MINT,
      market: 'SOL-PERP',
      side: 'long',
      orderType: 'market',
      collateralAtomic: '1000000',
      leverageBps: 10_000,
      slippageBps: 50,
      routeChoice: 'auto',
    }));
    await expectWalletMismatch(request(app).get('/api/futures/portfolio').query({ wallet: USDC_MINT }));
    await expectWalletMismatch(request(app).get('/api/futures/phoenix/access').query({ wallet: USDC_MINT }));
    await expectWalletMismatch(request(app).post('/api/futures/phoenix/auth/challenge').send({ wallet: USDC_MINT }));
    await expectWalletMismatch(request(app).post('/api/futures/phoenix/auth/login').send({ wallet: USDC_MINT }));
    await expectWalletMismatch(request(app).post('/api/futures/prepare').send({
      wallet: USDC_MINT,
      action: 'open',
      venue: 'gmtrade',
      quoteId: uuid,
      market: 'SOL-PERP',
      idempotencyKey: uuid,
    }));
    await expectWalletMismatch(request(app).post('/api/futures/execute').send({
      wallet: USDC_MINT,
      preparedId: uuid,
      signedTransaction: 'A'.repeat(120),
      idempotencyKey: uuid,
    }));
    await expectWalletMismatch(request(app).get('/api/futures/execution/' + uuid).query({ wallet: USDC_MINT }));
  });
});

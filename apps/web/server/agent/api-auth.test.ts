import express from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SOL_MINT, USDC_MINT } from '../../shared/constants.js';

vi.mock('@privy-io/node', () => ({
  verifyIdentityToken: vi.fn().mockResolvedValue({
    id: 'did:privy:agent-test',
    linked_accounts: [{
      type: 'wallet', chain_type: 'solana', wallet_client_type: 'privy-v2', connector_type: 'embedded', user_can_sign: true, address: SOL_MINT,
    }],
  }),
}));

let createApiRouter: typeof import('../api.js').createApiRouter;

beforeAll(async () => {
  const configModule = await import('../config.js');
  configModule.config.privyAppId = 'test-app';
  configModule.config.privyVerificationKey = 'test-key';
  createApiRouter = (await import('../api.js')).createApiRouter;
});

function testApp() {
  const app = express();
  app.use('/api', createApiRouter());
  return app;
}

const identity = { 'x-privy-identity-token': 'valid-agent-test-token' };
const policy = {
  wallet: SOL_MINT,
  name: 'Test agent',
  products: ['futures'],
  maxTransactionUsd: 25,
  maxDailyUsd: 100,
  maxSlippageBps: 50,
  maxFuturesLeverage: 3,
  maxOpenFuturesPositions: 2,
  allowedTokenMints: [SOL_MINT, USDC_MINT],
  allowedStockSymbols: [],
  allowedFuturesMarkets: ['SOL-PERP'],
  expiresInHours: 24,
};

describe('identity and capability-bound Agent API', () => {
  it('protects control-plane endpoints with Privy identity', async () => {
    const app = testApp();
    const missing = await request(app).get(`/api/agent/workspace?wallet=${SOL_MINT}`);
    expect(missing.status).toBe(401);

    const mismatch = await request(app).get(`/api/agent/workspace?wallet=${USDC_MINT}`).set(identity);
    expect(mismatch.status).toBe(403);
    expect(mismatch.body.error.code).toBe('WALLET_MISMATCH');
  });

  it('creates a narrow capability and accepts only a supported queued intent', async () => {
    const app = testApp();
    const created = await request(app).post('/api/agent/credentials').set(identity).send(policy).expect(201);
    expect(created.body.credential).toMatch(/^flay_agent_/);

    const queued = await request(app).post('/api/agent/requests')
      .set('Authorization', `Bearer ${created.body.credential}`)
      .send({
        idempotencyKey: crypto.randomUUID(),
        intent: { kind: 'futures-manage', action: 'cancel', venue: 'phoenix', market: 'SOL-PERP', nativeId: 'provider-order-1' },
      }).expect(202);
    expect(queued.body.request).toMatchObject({ status: 'pending', wallet: SOL_MINT, riskUsd: '0' });

    const workspace = await request(app).get(`/api/agent/workspace?wallet=${SOL_MINT}`).set(identity).expect(200);
    expect(workspace.body.requests[0].id).toBe(queued.body.request.id);
    expect(workspace.body.security).toMatchObject({ requiresUserApproval: true, fiatOnrampAvailable: false, arbitraryWalletAccess: false });
  });

  it('explicitly refuses fiat and general-wallet request kinds', async () => {
    const app = testApp();
    for (const kind of ['fiat-onramp', 'send', 'program-call']) {
      const response = await request(app).post('/api/agent/requests').send({ idempotencyKey: crypto.randomUUID(), intent: { kind, amount: '10' } });
      expect(response.status, kind).toBe(403);
      expect(response.body.error.code, kind).toBe('AGENT_ACTION_NOT_ALLOWED');
    }
  });

  it('cannot use an agent credential as identity for fiat funding', async () => {
    const app = testApp();
    const created = await request(app).post('/api/agent/credentials').set(identity).send(policy).expect(201);
    const response = await request(app).post('/api/fiat/checkout')
      .set('Authorization', `Bearer ${created.body.credential}`)
      .send({ wallet: SOL_MINT, fiat: 'USD', fiatAmount: '50.00' });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');
  });
});

import express from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SOL_MINT, USDC_MINT } from '../shared/constants.js';

vi.mock('@privy-io/node', () => ({
  verifyIdentityToken: vi.fn().mockResolvedValue({
    id: 'did:privy:gasless-send-owner',
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

beforeAll(async () => {
  const { config } = await import('./config.js');
  config.privyAppId = 'test-app';
  config.privyVerificationKey = 'test-key';
  createApiRouter = (await import('./api.js')).createApiRouter;
});

describe('identity-bound gasless USDC send API', () => {
  it('rejects preparation for a wallet outside the Privy identity before RPC work', async () => {
    const app = express();
    app.use('/api', createApiRouter());
    const response = await request(app)
      .post('/api/transfers/usdc/prepare')
      .set('x-privy-identity-token', 'valid-test-token')
      .send({ wallet: USDC_MINT, recipient: SOL_MINT, amountAtomic: '1' });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('WALLET_MISMATCH');

    const status = await request(app)
      .post('/api/transfers/usdc/status')
      .set('x-privy-identity-token', 'valid-test-token')
      .send({ wallet: USDC_MINT, recipient: SOL_MINT, amountAtomic: '1', signature: '2'.repeat(88) });
    expect(status.status).toBe(403);
    expect(status.body.error.code).toBe('WALLET_MISMATCH');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SOL_MINT, USDC_MINT } from '../../shared/constants.js';
import type { AgentPolicyInput } from '../../shared/agent.js';
import { AgentStore } from './store.js';

const policy: AgentPolicyInput = {
  name: 'Research agent',
  approvalMode: 'always-ask',
  products: ['convert', 'stocks', 'futures'],
  maxTransactionUsd: 25,
  maxDailyUsd: 100,
  maxSlippageBps: 50,
  maxFuturesLeverage: 3,
  maxOpenFuturesPositions: 2,
  allowedTokenMints: [SOL_MINT, USDC_MINT],
  allowedStockSymbols: ['AAPLX'],
  allowedFuturesMarkets: ['SOL-PERP'],
  expiresInHours: 24,
};

afterEach(() => vi.useRealTimers());

describe('agent capability store', () => {
  it('shows a credential once and retains only safe public data', () => {
    const store = new AgentStore();
    const created = store.createCredential('user-1', SOL_MINT, policy);
    expect(created.credential).toMatch(/^flay_agent_/);
    expect(store.authenticate(created.credential).wallet).toBe(SOL_MINT);

    const workspace = store.workspace('user-1', SOL_MINT);
    expect(workspace.credentials).toHaveLength(1);
    expect(workspace.events[0]).toMatchObject({ type: 'credential-created', wallet: SOL_MINT });
    expect(JSON.stringify(workspace)).not.toContain(created.credential);
    expect(JSON.stringify(workspace)).not.toMatch(/tokenHash|userId/);
    expect(JSON.stringify(workspace)).not.toMatch(/delegatedWalletId/);
  });

  it('binds idempotency keys to one exact intent', () => {
    const store = new AgentStore();
    const created = store.createCredential('user-1', SOL_MINT, policy);
    const credential = store.authenticate(created.credential);
    const key = crypto.randomUUID();
    const intent = { kind: 'convert' as const, inputMint: USDC_MINT, outputMint: SOL_MINT, amountAtomic: '1000000', slippageBps: 50 };
    const first = store.createRequest(credential, key, intent, '1000000');
    const repeated = store.createRequest(credential, key, intent, '1000000');
    expect(repeated.id).toBe(first.id);
    expect(() => store.createRequest(credential, key, { ...intent, amountAtomic: '2000000' }, '2000000'))
      .toThrowError(expect.objectContaining({ code: 'AGENT_IDEMPOTENCY_CONFLICT' }));
  });

  it('invalidates revoked and expired capabilities', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T00:00:00Z'));
    const store = new AgentStore();
    const revoked = store.createCredential('user-1', SOL_MINT, policy);
    const revokedRecord = store.authenticate(revoked.credential);
    const queued = store.createRequest(revokedRecord, crypto.randomUUID(), {
      kind: 'futures-manage', action: 'cancel', venue: 'phoenix', market: 'SOL-PERP', nativeId: 'order-1',
    }, '0');
    store.revoke('user-1', SOL_MINT, revoked.summary.id);
    expect(() => store.authenticate(revoked.credential)).toThrowError(expect.objectContaining({ code: 'AGENT_CREDENTIAL_REVOKED' }));
    expect(() => store.requestPolicy(store.ownedRequest('user-1', SOL_MINT, queued.id)))
      .toThrowError(expect.objectContaining({ code: 'AGENT_CREDENTIAL_INACTIVE' }));

    const expiring = store.createCredential('user-1', SOL_MINT, { ...policy, expiresInHours: 1 });
    vi.advanceTimersByTime(60 * 60_000 + 1);
    expect(() => store.authenticate(expiring.credential)).toThrowError(expect.objectContaining({ code: 'AGENT_CREDENTIAL_EXPIRED' }));
  });

  it('never exposes another user wallet workspace', () => {
    const store = new AgentStore();
    store.createCredential('user-1', SOL_MINT, policy);
    expect(store.workspace('user-2', SOL_MINT).credentials).toEqual([]);
    expect(store.workspace('user-1', USDC_MINT).credentials).toEqual([]);
  });

  it('returns an expired provider preparation to the approval queue', () => {
    const store = new AgentStore();
    const created = store.createCredential('user-1', SOL_MINT, policy);
    const credential = store.authenticate(created.credential);
    const queued = store.createRequest(credential, crypto.randomUUID(), {
      kind: 'convert', inputMint: USDC_MINT, outputMint: SOL_MINT, amountAtomic: '1000000', slippageBps: 50,
    }, '1000000');
    const record = store.ownedRequest('user-1', SOL_MINT, queued.id);
    store.markPrepared(record, {
      type: 'market',
      prepared: {
        preparedId: crypto.randomUUID(), kind: 'market-swap', provider: 'jupiter', providerLabel: 'Jupiter', wallet: SOL_MINT,
        transaction: 'transaction', messageHash: 'hash', expiresAt: Date.now() - 1, review: { warnings: [] },
      },
    });
    store.requeueExpiredPreparation(record);
    expect(store.workspace('user-1', SOL_MINT).requests[0]).toMatchObject({ status: 'pending', reviewedAt: null });
    expect(() => store.prepared(record)).toThrowError(expect.objectContaining({ code: 'AGENT_REQUEST_NOT_PREPARED' }));
  });
});

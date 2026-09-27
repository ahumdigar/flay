import { describe, expect, it, vi } from 'vitest';
import type { FuturesPrepareRequest } from '../../shared/futures.js';
import { FuturesPreparedStore } from './prepared-store.js';

const wallet = '11111111111111111111111111111111';
const idempotencyKey = '811ad33d-c22f-41f9-8bcd-bbb8b9a84551';

function request(overrides: Partial<FuturesPrepareRequest> = {}): FuturesPrepareRequest {
  return { wallet, action: 'activate', venue: 'phoenix', idempotencyKey, ...overrides };
}

function record(store: FuturesPreparedStore, overrides: Partial<FuturesPrepareRequest> = {}) {
  const value = request(overrides);
  return store.put({
    request: value,
    requestFingerprint: JSON.stringify(value),
    unsignedMessage: new Uint8Array([1, 2, 3]),
    allowedPrograms: [],
    allowedLookupTables: [],
    allowedAdditionalSigners: [],
    requiredAddresses: [wallet],
    quote: null,
    beforeVenuePortfolio: null,
    public: {
      action: value.action,
      venue: value.venue,
      wallet,
      transaction: 'transaction',
      messageHash: 'hash',
      expiresAt: Date.now() + 90_000,
      review: {
        market: null,
        nativeMarketAddress: null,
        side: null,
        orderType: null,
        collateralAtomic: null,
        sizeAtomic: null,
        priceMicroUsd: null,
        triggerPriceMicroUsd: null,
        executionPriceMicroUsd: null,
        executionFeeLamports: null,
        networkFeeLamports: null,
        accountRentLamports: null,
        lookupTables: [],
        programs: [],
        warnings: [],
      },
    },
  });
}

describe('FuturesPreparedStore idempotency and lifetime', () => {
  it('returns the same prepared action for the same key and rejects key reuse with another intent', () => {
    const store = new FuturesPreparedStore();
    const saved = record(store);
    expect(store.getByIdempotency(wallet, idempotencyKey, JSON.stringify(request()))?.public.preparedId).toBe(saved.public.preparedId);
    expect(() => store.getByIdempotency(wallet, idempotencyKey, 'changed')).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
  });

  it('stores one execution result for repeated submission keys', () => {
    const store = new FuturesPreparedStore();
    const saved = record(store);
    const execution = store.putExecution(saved.public.preparedId, idempotencyKey, {
      preparedId: saved.public.preparedId,
      venue: 'phoenix',
      action: 'activate',
      signature: 'signature',
      status: 'submitted',
      explorerUrl: 'https://explorer.solana.com/tx/signature',
      submittedAt: Date.now(),
      reconciledAt: null,
      detail: 'submitted',
    });
    expect(store.executionForKey(wallet, idempotencyKey)).toEqual(execution);
    expect(store.getExecution(execution.executionId, wallet)).toEqual(execution);
  });

  it('rejects unsigned work after its review lifetime', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const store = new FuturesPreparedStore();
      const saved = record(store);
      vi.advanceTimersByTime(90_001);
      expect(() => store.get(saved.public.preparedId)).toThrowError(expect.objectContaining({ code: 'FUTURES_PREPARED_EXPIRED' }));
    } finally {
      vi.useRealTimers();
    }
  });
});

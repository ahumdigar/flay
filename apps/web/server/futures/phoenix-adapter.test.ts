import { describe, expect, it, vi } from 'vitest';
import type { PhoenixAccess } from '../../shared/futures.js';
import { PhoenixStateCache, phoenixEntryReadiness, phoenixQuoteBookIsStale } from './phoenix-adapter.js';

describe('Phoenix bounded state cache', () => {
  it('deduplicates concurrent reads and uses a bounded stale value during retryable failure', async () => {
    let now = 1_000;
    let resolveLoad!: (value: { collateral: string }) => void;
    const firstLoad = new Promise<{ collateral: string }>((resolve) => { resolveLoad = resolve; });
    const loader = vi.fn().mockReturnValue(firstLoad);
    const cache = new PhoenixStateCache<{ collateral: string }>(100, 1_000, 200, () => now);

    const first = cache.get('wallet', loader);
    const concurrent = cache.get('wallet', loader);
    resolveLoad({ collateral: '1020000' });
    await expect(first).resolves.toEqual({ value: { collateral: '1020000' }, stale: false });
    await expect(concurrent).resolves.toEqual({ value: { collateral: '1020000' }, stale: false });
    expect(loader).toHaveBeenCalledTimes(1);

    now += 101;
    const failedRefresh = vi.fn().mockRejectedValue(new Error('429'));
    await expect(cache.get('wallet', failedRefresh)).resolves.toEqual({ value: { collateral: '1020000' }, stale: true });
    await expect(cache.get('wallet', failedRefresh)).resolves.toEqual({ value: { collateral: '1020000' }, stale: true });
    expect(failedRefresh).toHaveBeenCalledTimes(1);
    expect(cache.status('wallet')).toMatchObject({ stale: true, fetchedAt: 1_000, lastErrorAt: 1_101 });

    now += 1_001;
    await expect(cache.get('wallet', failedRefresh)).rejects.toThrow('429');
  });

  it('drops wallet state explicitly after a write', async () => {
    const cache = new PhoenixStateCache<string>(100, 1_000, 200, () => 1_000);
    await cache.get('wallet', async () => 'verified');
    cache.invalidate('wallet');
    expect(cache.status('wallet')).toEqual({ stale: false, fetchedAt: null, lastErrorAt: null });
    await expect(cache.get('wallet', async () => 'after-write')).resolves.toEqual({ value: 'after-write', stale: false });
  });
});

function access(overrides: Partial<PhoenixAccess> = {}): PhoenixAccess {
  return {
    wallet: '11111111111111111111111111111111',
    publicData: true,
    activated: true,
    traderRegistered: true,
    executionEligible: true,
    status: 'active',
    message: 'Phoenix execution is active.',
    onboardingUrl: 'https://docs.phoenix.trade/sdk/register',
    checkedAt: Date.now(),
    ...overrides,
  };
}

describe('Phoenix entry setup sequencing', () => {
  it('bases quote freshness on the order book used after a slow peer venue', () => {
    const quoteAt = 30_000;
    expect(phoenixQuoteBookIsStale(quoteAt, quoteAt - 1)).toBe(false);
    expect(phoenixQuoteBookIsStale(quoteAt, quoteAt - 12_001)).toBe(true);
  });

  it('requires public onboarding before a new wallet can enter', () => {
    expect(phoenixEntryReadiness(access({
      activated: false,
      traderRegistered: false,
      executionEligible: false,
      status: 'onboarding-required',
      message: 'Phoenix public onboarding is required.',
    }), null, '1000000')).toMatchObject({
      executionEligible: false,
      setupSteps: ['activate'],
      exclusionCode: 'PHOENIX_ONBOARDING_REQUIRED',
    });
  });

  it('requires a separate trader registration when activation exists without the account', () => {
    expect(phoenixEntryReadiness(access({
      traderRegistered: false,
      executionEligible: false,
      status: 'registration-required',
    }), null, '1000000')).toMatchObject({
      executionEligible: false,
      setupSteps: ['register'],
      exclusionCode: 'PHOENIX_ONBOARDING_REQUIRED',
    });
  });

  it('fails closed when active-wallet collateral state cannot be loaded', () => {
    expect(phoenixEntryReadiness(access(), null, '1000000')).toMatchObject({
      executionEligible: false,
      setupSteps: [],
      exclusionCode: 'PHOENIX_STATE_UNAVAILABLE',
    });
  });

  it('requires a separate deposit until parent collateral covers the requested entry', () => {
    expect(phoenixEntryReadiness(access(), '999999', '1000000')).toMatchObject({
      executionEligible: false,
      setupSteps: ['deposit'],
      exclusionCode: 'PHOENIX_COLLATERAL_REQUIRED',
    });
    expect(phoenixEntryReadiness(access(), '1000000', '1000000')).toEqual({
      executionEligible: true,
      setupSteps: [],
      exclusionCode: null,
      exclusionReason: null,
    });
  });
});

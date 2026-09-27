import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from './errors.js';
import { fetchJson } from './fetch-json.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('bounded provider responses', () => {
  it('parses a valid JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"value":7}', { status: 200 })));
    await expect(fetchJson<{ value: number }>('https://provider.example/quote', { provider: 'Provider', maxBytes: 100 }))
      .resolves.toEqual({ value: 7 });
  });

  it('rejects a streamed body as soon as it exceeds its size limit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"veryLong":"0123456789"}', { status: 200 })));
    try {
      await fetchJson('https://provider.example/quote', { provider: 'Provider', maxBytes: 8 });
      throw new Error('expected response to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('PROVIDER_RESPONSE_TOO_LARGE');
    }
  });


  it('retries a rate-limited read once without retrying mutations', async () => {
    vi.useFakeTimers();
    const readFetch = vi.fn()
      .mockResolvedValueOnce(new Response('{"message":"Too Many Requests"}', {
        status: 429,
        headers: { 'retry-after': '0.01' },
      }))
      .mockResolvedValueOnce(new Response('{"value":9}', { status: 200 }));
    vi.stubGlobal('fetch', readFetch);
    const pending = fetchJson<{ value: number }>('https://provider.example/quote', { provider: 'Jupiter' });
    await vi.advanceTimersByTimeAsync(20);
    await expect(pending).resolves.toEqual({ value: 9 });
    expect(readFetch).toHaveBeenCalledTimes(2);

    const mutationFetch = vi.fn().mockResolvedValue(new Response('{"message":"Too Many Requests"}', { status: 429 }));
    vi.stubGlobal('fetch', mutationFetch);
    await expect(fetchJson('https://provider.example/order', { provider: 'Jupiter Trigger', method: 'POST' }))
      .rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED', retryable: true });
    expect(mutationFetch).toHaveBeenCalledTimes(1);
  });

  it('turns provider HTTP and malformed JSON into actionable errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"message":"maintenance"}', { status: 503 })));
    await expect(fetchJson('https://provider.example/quote', { provider: 'Provider' }))
      .rejects.toMatchObject({ code: 'PROVIDER_REJECTED', retryable: true });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { issues: [{ path: ['params', 'expiredAt'], message: 'Expected string' }] },
    }), { status: 400 })));
    await expect(fetchJson('https://provider.example/order', { provider: 'Provider' }))
      .rejects.toMatchObject({ code: 'PROVIDER_REJECTED', message: 'Provider: params.expiredAt: Expected string' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad JSON', { status: 200 })));
    await expect(fetchJson('https://provider.example/quote', { provider: 'Provider' }))
      .rejects.toMatchObject({ code: 'PROVIDER_BAD_RESPONSE', retryable: true });
  });
});

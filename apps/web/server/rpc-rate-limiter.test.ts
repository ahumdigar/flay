import { afterEach, describe, expect, it, vi } from 'vitest';
import { RpcQueueTimeoutError, RpcRequestLimiter } from './rpc-rate-limiter.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('RpcRequestLimiter', () => {
  it('starts queued work in FIFO order within the configured rate budget', async () => {
    vi.useFakeTimers();
    const limiter = new RpcRequestLimiter({ maxRequestsPerSecond: 2, maxConcurrency: 4, queueTimeoutMs: 5_000 });
    const starts: Array<{ id: number; at: number }> = [];
    const jobs = [1, 2, 3].map((id) => limiter.schedule(async () => {
      starts.push({ id, at: Date.now() });
      return id;
    }));

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(Promise.all(jobs)).resolves.toEqual([1, 2, 3]);
    expect(starts.map((entry) => entry.id)).toEqual([1, 2, 3]);
    expect(starts[1].at - starts[0].at).toBeGreaterThanOrEqual(500);
    expect(starts[2].at - starts[1].at).toBeGreaterThanOrEqual(500);
  });

  it('does not exceed the configured concurrency cap', async () => {
    vi.useFakeTimers();
    const limiter = new RpcRequestLimiter({ maxRequestsPerSecond: 1_000, maxConcurrency: 2, queueTimeoutMs: 5_000 });
    const releases: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    const jobs = [1, 2, 3].map(() => limiter.schedule(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
    }));

    await vi.advanceTimersByTimeAsync(5);
    expect(active).toBe(2);
    expect(peak).toBe(2);
    releases.shift()?.();
    await vi.advanceTimersByTimeAsync(1);
    expect(active).toBe(2);
    releases.splice(0).forEach((release) => release());
    await vi.runAllTimersAsync();
    await Promise.all(jobs);
    expect(peak).toBe(2);
  });

  it('rejects work that cannot leave the queue within the timeout', async () => {
    vi.useFakeTimers();
    const limiter = new RpcRequestLimiter({ maxRequestsPerSecond: 1, maxConcurrency: 1, queueTimeoutMs: 100 });
    let release!: () => void;
    const running = limiter.schedule(() => new Promise<void>((resolve) => { release = resolve; }));
    const queued = limiter.schedule(async () => undefined);
    const rejected = expect(queued).rejects.toBeInstanceOf(RpcQueueTimeoutError);

    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    release();
    await running;
  });
});

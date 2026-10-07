export interface RpcRequestLimiterOptions {
  maxRequestsPerSecond: number;
  maxConcurrency: number;
  queueTimeoutMs: number;
}

interface PendingRequest {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout> | null;
  cancelled: boolean;
}

export class RpcQueueTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Solana RPC request queue exceeded ${timeoutMs}ms.`);
    this.name = 'RpcQueueTimeoutError';
  }
}

/**
 * Smooths requests across a one-second budget instead of releasing a burst at
 * each window boundary. This leaves provider capacity for the GMTrade sidecar
 * while bounding both HTTP concurrency and time spent waiting in the queue.
 */
export class RpcRequestLimiter {
  private readonly intervalMs: number;
  private readonly queue: PendingRequest[] = [];
  private active = 0;
  private nextStartAt = 0;
  private wake: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: RpcRequestLimiterOptions) {
    if (!Number.isInteger(options.maxRequestsPerSecond) || options.maxRequestsPerSecond < 1) {
      throw new Error('maxRequestsPerSecond must be a positive integer.');
    }
    if (!Number.isInteger(options.maxConcurrency) || options.maxConcurrency < 1) {
      throw new Error('maxConcurrency must be a positive integer.');
    }
    if (!Number.isInteger(options.queueTimeoutMs) || options.queueTimeoutMs < 1) {
      throw new Error('queueTimeoutMs must be a positive integer.');
    }
    this.intervalMs = Math.ceil(1_000 / options.maxRequestsPerSecond);
  }

  schedule<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const pending: PendingRequest = {
        run,
        resolve: (value) => resolve(value as T),
        reject,
        cancelled: false,
        timeout: null,
      };
      pending.timeout = setTimeout(() => {
        pending.cancelled = true;
        reject(new RpcQueueTimeoutError(this.options.queueTimeoutMs));
        this.drain();
      }, this.options.queueTimeoutMs);
      this.queue.push(pending);
      this.drain();
    });
  }

  private drain(): void {
    while (this.queue[0]?.cancelled) this.queue.shift();
    if (!this.queue.length || this.active >= this.options.maxConcurrency) return;

    const waitMs = this.nextStartAt - Date.now();
    if (waitMs > 0) {
      if (!this.wake) {
        this.wake = setTimeout(() => {
          this.wake = null;
          this.drain();
        }, waitMs);
      }
      return;
    }

    const pending = this.queue.shift()!;
    if (pending.cancelled) {
      this.drain();
      return;
    }
    if (pending.timeout) clearTimeout(pending.timeout);
    this.active += 1;
    this.nextStartAt = Date.now() + this.intervalMs;
    Promise.resolve()
      .then(pending.run)
      .then(pending.resolve, pending.reject)
      .finally(() => {
        this.active -= 1;
        this.drain();
      });
    this.drain();
  }
}

export function createRateLimitedFetch(
  limiter: RpcRequestLimiter,
  fetcher: typeof fetch = globalThis.fetch,
): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => (
    limiter.schedule(() => fetcher(input, init))
  )) as typeof fetch;
}

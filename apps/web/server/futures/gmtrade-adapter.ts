import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  FuturesIntent,
  FuturesRouteQuote,
  FuturesVenueMarket,
  FuturesVenuePortfolio,
} from '../../shared/futures.js';
import { excludedQuote, type VenueAdapter } from './domain.js';

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
}

interface SidecarEnvelope {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code?: string; message?: string };
}

const MAX_LINE_BYTES = 1_048_576;
const READ_CACHE_MS = 15_000;
const LAST_VERIFIED_READINESS_MS = 120_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export function gmTradeQuoteError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'GMTrade quote is unavailable.';
  if (/liquidatable position:\s*min collateral/i.test(message)) {
    return 'GMTrade requires more collateral for this market and leverage. Increase the collateral amount and refresh routes.';
  }
  return message;
}

function defaultBinaryPath(): string {
  const current = path.dirname(fileURLToPath(import.meta.url));
  const service = path.resolve(current, '../../../../services/gmtrade-adapter');
  return process.platform === 'android'
    ? path.join(service, 'run-termux.sh')
    : path.join(service, 'target/release/flay-gmtrade-adapter');
}

export class GmTradeAdapter implements VenueAdapter {
  readonly venue = 'gmtrade' as const;
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private readonly pending = new Map<string, PendingRequest>();
  private readonly binary = process.env.GMTRADE_ADAPTER_BIN?.trim() || defaultBinaryPath();
  private restartAfter = 0;
  private readonly requestTimeoutMs = Math.max(100, Math.min(30_000, Number(process.env.GMTRADE_ADAPTER_TIMEOUT_MS ?? DEFAULT_REQUEST_TIMEOUT_MS) || DEFAULT_REQUEST_TIMEOUT_MS));
  private marketCache: { at: number; value: FuturesVenueMarket[] } | null = null;
  private marketInFlight: Promise<FuturesVenueMarket[]> | null = null;
  private readinessCache: { at: number; value: Awaited<ReturnType<GmTradeAdapter['loadReadiness']>> } | null = null;
  private readinessInFlight: Promise<Awaited<ReturnType<GmTradeAdapter['loadReadiness']>>> | null = null;
  private lastVerifiedReadiness: { at: number; value: { publicData: true; execution: true; status: 'ready'; detail: string; checkedAt: number } } | null = null;
  private readonly metrics = { requests: 0, failures: 0, lastLatencyMs: 0, lastFailureAt: null as number | null };

  private start(): ChildProcessWithoutNullStreams | null {
    if (this.child && !this.child.killed && this.child.exitCode === null && !this.child.stdin.destroyed && !this.child.stdin.writableEnded) return this.child;
    this.child = null;
    if (!existsSync(this.binary) || Date.now() < this.restartAfter) return null;
    const child = spawn(this.binary, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        PREFIX: process.env.PREFIX,
        TMPDIR: process.env.TMPDIR,
        LANG: process.env.LANG,
        LC_ALL: process.env.LC_ALL,
        LC_CTYPE: process.env.LC_CTYPE,
        LD_PRELOAD: process.env.LD_PRELOAD,
        LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH,
        TERMUX_EXEC__PROC_SELF_EXE: process.env.TERMUX_EXEC__PROC_SELF_EXE,
        TERMUX_VERSION: process.env.TERMUX_VERSION,
        SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
        RUST_LOG: 'error',
      },
    });
    this.child = child;
    this.buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdin.on('error', () => { /* Write callbacks and process lifecycle reject affected requests. */ });
    child.stdout.on('data', (chunk: string) => this.consume(chunk));
    child.stderr.on('data', () => { /* Provider diagnostics deliberately stay out of request logs. */ });
    const failChild = (message: string) => {
      if (this.child === child) this.child = null;
      this.restartAfter = Date.now() + 1_000;
      for (const [id, request] of this.pending) {
        clearTimeout(request.timeout);
        request.reject(new Error(message));
        this.pending.delete(id);
      }
    };
    child.on('error', () => failChild('GMTrade adapter could not be started.'));
    child.on('exit', () => failChild('GMTrade adapter exited before responding.'));
    return child;
  }

  private stop(child: ChildProcessWithoutNullStreams) {
    if (this.child === child) this.child = null;
    this.restartAfter = Math.max(this.restartAfter, Date.now() + 1_000);
    if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end();
    const force = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 750);
    force.unref();
  }

  private consume(chunk: string) {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > MAX_LINE_BYTES) {
      if (this.child) this.stop(this.child);
      return;
    }
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let response: SidecarEnvelope;
      try { response = JSON.parse(line) as SidecarEnvelope; } catch { if (this.child) this.stop(this.child); return; }
      const request = this.pending.get(response.id);
      if (!request) continue;
      this.pending.delete(response.id);
      clearTimeout(request.timeout);
      if (response.ok) request.resolve(response.result);
      else request.reject(new Error(response.error?.message ?? 'GMTrade adapter rejected the request.'));
    }
  }

  async command<T>(command: string, payload: Record<string, unknown> = {}): Promise<T> {
    const child = this.start();
    if (!child) {
      if (!existsSync(this.binary)) throw new Error('The pinned GMTrade adapter binary has not been built.');
      throw new Error('The GMTrade adapter is temporarily unavailable while recovering from a provider failure.');
    }
    const id = randomUUID();
    const line = JSON.stringify({ id, command, payload });
    if (Buffer.byteLength(line) > 64_000) throw new Error('GMTrade adapter request is too large.');
    const startedAt = Date.now();
    this.metrics.requests += 1;
    try {
      return await new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pending.delete(id);
          this.stop(child);
          reject(new Error('GMTrade adapter did not respond in time.'));
        }, this.requestTimeoutMs);
        this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timeout });
        child.stdin.write(`${line}\n`, (error) => {
          if (!error) return;
          clearTimeout(timeout);
          this.pending.delete(id);
          reject(error);
        });
      });
    } catch (error) {
      this.metrics.failures += 1;
      this.metrics.lastFailureAt = Date.now();
      throw error;
    } finally {
      this.metrics.lastLatencyMs = Date.now() - startedAt;
    }
  }

  async readiness() {
    if (this.readinessCache && Date.now() - this.readinessCache.at < READ_CACHE_MS) return this.readinessCache.value;
    if (this.readinessInFlight) return this.readinessInFlight;
    this.readinessInFlight = this.loadReadiness();
    try {
      const value = await this.readinessInFlight;
      this.readinessCache = { at: Date.now(), value };
      return value;
    } finally {
      this.readinessInFlight = null;
    }
  }

  private async loadReadiness() {
    try {
      const result = await this.command<{ sdkVersion: string; sdkRevision: string; programId: string; deploymentVerified: boolean }>('health');
      if (!result.deploymentVerified) return { publicData: false, execution: false, status: 'degraded' as const, detail: 'GMTrade program baseline changed; new entries are disabled.', checkedAt: Date.now() };
      const value = { publicData: true as const, execution: true as const, status: 'ready' as const, detail: `GMTrade adapter ${result.sdkVersion} (${result.sdkRevision.slice(0, 7)}) is ready.`, checkedAt: Date.now() };
      this.lastVerifiedReadiness = { at: Date.now(), value };
      return value;
    } catch (error) {
      if (this.lastVerifiedReadiness && Date.now() - this.lastVerifiedReadiness.at <= LAST_VERIFIED_READINESS_MS) {
        return {
          ...this.lastVerifiedReadiness.value,
          status: 'degraded' as const,
          detail: `GMTrade was verified recently; its latest health refresh failed: ${error instanceof Error ? error.message : 'provider unavailable'}`,
          checkedAt: Date.now(),
        };
      }
      return { publicData: false, execution: false, status: 'unavailable' as const, detail: error instanceof Error ? error.message : 'GMTrade adapter is unavailable.', checkedAt: Date.now() };
    }
  }

  async markets(): Promise<FuturesVenueMarket[]> {
    if (this.marketCache && Date.now() - this.marketCache.at < READ_CACHE_MS) return this.marketCache.value;
    if (this.marketInFlight) return this.marketInFlight;
    this.marketInFlight = this.command<FuturesVenueMarket[]>('markets');
    try {
      const value = await this.marketInFlight;
      this.marketCache = { at: Date.now(), value };
      return value;
    } finally {
      this.marketInFlight = null;
    }
  }

  diagnostics() {
    return { ...this.metrics, running: Boolean(this.child && !this.child.killed), binary: existsSync(this.binary) };
  }

  close() {
    const child = this.child;
    this.child = null;
    if (child) this.stop(child);
  }

  async quote(intent: FuturesIntent, market: FuturesVenueMarket): Promise<FuturesRouteQuote> {
    try {
      return await this.command<FuturesRouteQuote>('quote', { intent, market });
    } catch (error) {
      return excludedQuote('gmtrade', intent, market, 'GMTRADE_UNAVAILABLE', gmTradeQuoteError(error));
    }
  }

  async portfolio(wallet: string): Promise<FuturesVenuePortfolio> {
    return this.command<FuturesVenuePortfolio>('portfolio', { wallet });
  }

  async prepareAction(payload: Record<string, unknown>): Promise<{ transaction: string; programs: string[]; lookupTables?: string[]; marketAddress?: string | null; warnings?: string[] }> {
    return this.command('prepare_action', payload);
  }
}

import { randomUUID } from 'node:crypto';
import type { FuturesExecution, FuturesPrepareRequest, FuturesPreparedStep, FuturesRouteQuote, FuturesVenuePortfolio } from '../../shared/futures.js';
import { AppError } from '../errors.js';

export interface FuturesPreparedRecord {
  public: FuturesPreparedStep;
  request: FuturesPrepareRequest;
  requestFingerprint: string;
  unsignedMessage: Uint8Array;
  allowedPrograms: string[];
  allowedLookupTables: string[];
  allowedAdditionalSigners: string[];
  requiredAddresses: string[];
  quote: FuturesRouteQuote | null;
  beforeVenuePortfolio: FuturesVenuePortfolio | null;
  executedSignature?: string;
  executionId?: string;
}

export class FuturesPreparedStore {
  private readonly prepared = new Map<string, FuturesPreparedRecord>();
  private readonly prepareKeys = new Map<string, string>();
  private readonly executions = new Map<string, FuturesExecution>();
  private readonly executeKeys = new Map<string, string>();

  getByIdempotency(wallet: string, key: string, fingerprint: string): FuturesPreparedRecord | null {
    this.sweep();
    const id = this.prepareKeys.get(`${wallet}:${key}`);
    if (!id) return null;
    const record = this.prepared.get(id);
    if (!record) return null;
    if (record.requestFingerprint !== fingerprint) {
      throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different futures action.');
    }
    return record;
  }

  put(input: Omit<FuturesPreparedRecord, 'public'> & { public: Omit<FuturesPreparedStep, 'preparedId'> }): FuturesPreparedRecord {
    this.sweep();
    const preparedId = randomUUID();
    const record: FuturesPreparedRecord = { ...input, public: { ...input.public, preparedId } };
    this.prepared.set(preparedId, record);
    this.prepareKeys.set(`${record.request.wallet}:${record.request.idempotencyKey}`, preparedId);
    return record;
  }

  get(preparedId: string): FuturesPreparedRecord {
    this.sweep();
    const record = this.prepared.get(preparedId);
    if (!record) throw new AppError(410, 'FUTURES_PREPARED_EXPIRED', 'This futures transaction expired. Review a fresh action.', true);
    if (record.public.expiresAt <= Date.now() && !record.executedSignature) {
      throw new AppError(410, 'FUTURES_PREPARED_EXPIRED', 'This futures transaction expired before signing. Review it again.', true);
    }
    return record;
  }

  executionForKey(wallet: string, key: string): FuturesExecution | null {
    const executionId = this.executeKeys.get(`${wallet}:${key}`);
    return executionId ? this.executions.get(executionId) ?? null : null;
  }

  putExecution(preparedId: string, idempotencyKey: string, execution: Omit<FuturesExecution, 'executionId'>): FuturesExecution {
    const record = this.get(preparedId);
    const existing = this.executionForKey(record.request.wallet, idempotencyKey);
    if (existing) return existing;
    const stored = { ...execution, executionId: randomUUID() };
    record.executedSignature = stored.signature;
    record.executionId = stored.executionId;
    this.executions.set(stored.executionId, stored);
    this.executeKeys.set(`${record.request.wallet}:${idempotencyKey}`, stored.executionId);
    return stored;
  }

  getExecution(executionId: string, wallet: string): FuturesExecution {
    const execution = this.executions.get(executionId);
    if (!execution) throw new AppError(404, 'FUTURES_EXECUTION_NOT_FOUND', 'This futures execution record was not found.');
    const record = this.prepared.get(execution.preparedId);
    if (!record || record.request.wallet !== wallet) throw new AppError(403, 'WALLET_MISMATCH', 'This execution belongs to another wallet.');
    return execution;
  }

  updateExecution(execution: FuturesExecution): void {
    this.executions.set(execution.executionId, execution);
  }

  private sweep() {
    const now = Date.now();
    for (const [id, record] of this.prepared) {
      const retention = record.executedSignature ? 24 * 60 * 60_000 : 30 * 60_000;
      if (record.public.expiresAt + retention > now) continue;
      this.prepared.delete(id);
      this.prepareKeys.delete(`${record.request.wallet}:${record.request.idempotencyKey}`);
    }
    while (this.executions.size > 5_000) this.executions.delete(this.executions.keys().next().value!);
  }
}

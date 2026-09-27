import { randomUUID } from 'node:crypto';
import { AppError } from './errors.js';
import type { ExecutionResult } from '../shared/types.js';
import type { PreparedRecord, QuoteSnapshot } from './domain.js';

export class EphemeralStore {
  private readonly quotes = new Map<string, QuoteSnapshot>();
  private readonly prepared = new Map<string, PreparedRecord>();

  putQuote(snapshot: Omit<QuoteSnapshot, 'id'>): QuoteSnapshot {
    this.sweep();
    const stored: QuoteSnapshot = { ...snapshot, id: randomUUID() };
    stored.quote.id = stored.id;
    this.quotes.set(stored.id, stored);
    return stored;
  }

  getQuote(id: string): QuoteSnapshot {
    this.sweep();
    const value = this.quotes.get(id);
    if (!value) throw new AppError(410, 'QUOTE_EXPIRED', 'That quote expired. Request fresh routes and review again.', true);
    if (value.quote.expiresAt <= Date.now()) {
      this.quotes.delete(id);
      throw new AppError(410, 'QUOTE_EXPIRED', 'That quote expired. Request fresh routes and review again.', true);
    }
    return value;
  }

  putPrepared(record: Omit<PreparedRecord, 'public'> & { public: Omit<PreparedRecord['public'], 'preparedId'> }): PreparedRecord {
    this.sweep();
    const preparedId = randomUUID();
    const stored: PreparedRecord = {
      ...record,
      public: { ...record.public, preparedId },
    };
    this.prepared.set(preparedId, stored);
    return stored;
  }

  getPrepared(id: string): PreparedRecord {
    this.sweep();
    const value = this.prepared.get(id);
    if (!value) throw new AppError(410, 'PREPARED_TRANSACTION_EXPIRED', 'This transaction is no longer valid. Review and build a fresh one.', true);
    if (value.public.expiresAt <= Date.now() && !value.executedSignature) {
      this.prepared.delete(id);
      throw new AppError(410, 'PREPARED_TRANSACTION_EXPIRED', 'This transaction expired before it was sent. Review and try again.', true);
    }
    return value;
  }

  markExecuted(id: string, result: ExecutionResult): void {
    const value = this.getPrepared(id);
    value.executedSignature = result.signature;
    value.executionResult = result;
  }

  markSubmitted(id: string, signature: string): void {
    const value = this.getPrepared(id);
    if (value.executedSignature && value.executedSignature !== signature) {
      throw new AppError(409, 'SPONSORED_COMPLETION_CONFLICT', 'This reviewed transaction was already submitted with another signature.');
    }
    value.executedSignature = signature;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, value] of this.quotes) if (value.quote.expiresAt <= now) this.quotes.delete(key);
    for (const [key, value] of this.prepared) {
      if (value.public.expiresAt + 10 * 60_000 <= now) this.prepared.delete(key);
    }
  }
}

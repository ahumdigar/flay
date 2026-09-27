import type { FuturesIntent, FuturesRouteQuote } from '../../shared/futures.js';
import { AppError } from '../errors.js';

interface StoredQuote {
  intent: FuturesIntent;
  quote: FuturesRouteQuote;
}

export class FuturesQuoteStore {
  private readonly records = new Map<string, StoredQuote>();

  put(intent: FuturesIntent, quote: FuturesRouteQuote) {
    this.sweep();
    this.records.set(quote.id, { intent: structuredClone(intent), quote: structuredClone(quote) });
  }

  get(id: string, wallet: string): StoredQuote {
    this.sweep();
    const record = this.records.get(id);
    if (!record || record.quote.expiresAt <= Date.now()) throw new AppError(410, 'FUTURES_QUOTE_EXPIRED', 'The futures quote expired. Refresh routes and review again.', true);
    if (record.intent.wallet !== wallet) throw new AppError(403, 'WALLET_MISMATCH', 'The quote belongs to a different wallet.');
    return structuredClone(record);
  }

  private sweep() {
    const now = Date.now();
    for (const [id, record] of this.records) if (record.quote.expiresAt <= now) this.records.delete(id);
    while (this.records.size > 2_000) this.records.delete(this.records.keys().next().value!);
  }
}

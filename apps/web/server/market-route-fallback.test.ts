import { describe, expect, it, vi } from 'vitest';
import type { MarketQuote, QuoteProvider } from '../shared/types.js';
import { AppError } from './errors.js';
import { prepareRankedMarketRoute } from './market-route-fallback.js';

function route(id: string, provider: QuoteProvider): MarketQuote {
  return { id, provider } as MarketQuote;
}

describe('server market route fallback', () => {
  const jupiter = route('jupiter', 'jupiter');
  const raydium = route('raydium', 'raydium');
  const orca = route('orca', 'orca');

  it('uses the next ranked venue after a venue-local build rejection', async () => {
    const attempted: string[] = [];
    const prepared = await prepareRankedMarketRoute([jupiter, raydium, orca], async (candidate) => {
      attempted.push(candidate.id);
      if (candidate.provider === 'jupiter') {
        throw new AppError(400, 'PROVIDER_REJECTED', 'Jupiter: Failed to get quotes');
      }
      return { provider: candidate.provider, transaction: 'validated-transaction' };
    });

    expect(attempted).toEqual(['jupiter', 'raydium']);
    expect(prepared).toEqual({ provider: 'raydium', transaction: 'validated-transaction' });
  });

  it('keeps exhausted venue failures bounded and retryable', async () => {
    const prepare = vi.fn(async (candidate: MarketQuote) => {
      throw new AppError(502, 'PROVIDER_UNAVAILABLE', `${candidate.provider}: ${'x'.repeat(300)}`, true);
    });

    await expect(prepareRankedMarketRoute([jupiter, raydium, orca], prepare)).rejects.toMatchObject({
      status: 409,
      code: 'AGENT_NO_EXECUTABLE_ROUTE',
      retryable: true,
    });
    expect(prepare).toHaveBeenCalledTimes(3);
    await prepareRankedMarketRoute([jupiter, route('jupiter-duplicate', 'jupiter'), raydium, orca], prepare).catch((error: AppError) => {
      expect(error.message.length).toBeLessThan(420);
      expect(error.message).toContain('Jupiter:');
    });
    expect(prepare).toHaveBeenCalledTimes(6);
  });

  it('does not bypass balance or transaction-integrity failures', async () => {
    for (const error of [
      new AppError(409, 'INSUFFICIENT_BALANCE', 'Add funds.'),
      new AppError(502, 'PROVIDER_TRANSACTION_INVALID', 'Unsafe transaction.'),
    ]) {
      const prepare = vi.fn().mockRejectedValue(error);
      await expect(prepareRankedMarketRoute([jupiter, raydium], prepare)).rejects.toBe(error);
      expect(prepare).toHaveBeenCalledTimes(1);
    }
  });

  it('prepares one available route exactly once', async () => {
    const prepare = vi.fn().mockResolvedValue({ provider: 'orca' });
    await expect(prepareRankedMarketRoute([orca], prepare)).resolves.toEqual({ provider: 'orca' });
    expect(prepare).toHaveBeenCalledOnce();
  });
});

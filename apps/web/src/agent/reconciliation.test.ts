import { describe, expect, it } from 'vitest';
import type { AgentExecutionResponse, AgentReviewResponse } from '../../shared/agent.js';
import type { PreparedTransaction } from '../../shared/types.js';
import { agentMarketActivity, mergeStoredActivity, type StoredActivity } from './reconciliation.js';

function completion(kind: 'convert' | 'stock' = 'convert') {
  const prepared = {
    provider: 'jupiter',
    review: {
      warnings: [],
      ...(kind === 'stock' ? {
        stock: {
          symbol: 'AAPLX', side: 'buy', mint: 'stock-mint', multiplier: { value: '1', source: 'xstocks' }, expectedOutputDisplay: '0.1',
        },
      } : {}),
    },
  } as unknown as PreparedTransaction;
  const review = {
    request: { intent: kind === 'convert' ? { kind: 'convert' } : { kind: 'stock' } },
    action: { type: 'market', prepared },
  } as AgentReviewResponse;
  const execution = {
    request: review.request,
    result: {
      signature: 'confirmed-signature', status: 'confirmed', explorerUrl: 'https://explorer.invalid', provider: 'Jupiter Swap V2',
      gasPayment: { mode: 'provider-sponsored', provider: 'Jupiter', feePayer: 'payer', detail: 'Sponsored.' },
    },
  } as AgentExecutionResponse;
  return { execution, review };
}

describe('Agent transaction reconciliation', () => {
  it('classifies a confirmed Convert for the standard Activity verifier', () => {
    const { execution, review } = completion();
    expect(agentMarketActivity(execution, review, 123)).toEqual({
      signature: 'confirmed-signature',
      kind: 'Market',
      provider: 'Jupiter Swap V2',
      gasPayment: { mode: 'provider-sponsored', provider: 'Jupiter' },
      createdAt: 123,
    });
  });

  it('preserves resolved stock context and ignores Futures completions', () => {
    const stock = completion('stock');
    expect(agentMarketActivity(stock.execution, stock.review)?.kind).toBe('Stock');
    const futuresReview = { ...stock.review, action: { type: 'futures', prepared: {} } } as AgentReviewResponse;
    expect(agentMarketActivity(stock.execution, futuresReview)).toBeNull();
  });

  it('deduplicates signatures and keeps the activity store bounded', () => {
    const existing = Array.from({ length: 50 }, (_, index): StoredActivity => ({
      signature: `signature-${index}`,
      kind: 'Market',
      provider: 'Provider',
      createdAt: index,
    }));
    const next = mergeStoredActivity(existing, { ...existing[10], provider: 'Updated' });
    expect(next).toHaveLength(50);
    expect(next[0]).toMatchObject({ signature: 'signature-10', provider: 'Updated' });
    expect(next.filter((item) => item.signature === 'signature-10')).toHaveLength(1);
  });
});

import type { AgentExecutionResponse, AgentReviewResponse } from '../../shared/agent.js';
import type { ExecutionResult, GasPayment, StockTradeContext } from '../../shared/types.js';

export interface StoredActivity {
  signature: string;
  kind: 'Market' | 'Limit' | 'Stock';
  provider: string;
  gasPayment?: Pick<GasPayment, 'mode' | 'provider'>;
  createdAt: number;
  stock?: StockTradeContext;
}

export function agentMarketActivity(
  execution: AgentExecutionResponse,
  review: AgentReviewResponse,
  createdAt = Date.now(),
): StoredActivity | null {
  if (review.action.type !== 'market' || !('provider' in execution.result)) return null;
  const result = execution.result as ExecutionResult;
  const stock = review.action.prepared.review.stock;
  if (execution.request.intent.kind === 'stock' && !stock) return null;
  return {
    signature: result.signature,
    kind: stock ? 'Stock' : 'Market',
    provider: result.provider,
    ...(result.gasPayment ? {
      gasPayment: {
        mode: result.gasPayment.mode,
        provider: result.gasPayment.provider,
      },
    } : {}),
    createdAt,
    ...(stock ? { stock } : {}),
  };
}

export function mergeStoredActivity(current: StoredActivity[], entry: StoredActivity): StoredActivity[] {
  return [entry, ...current.filter((item) => item.signature !== entry.signature)].slice(0, 50);
}

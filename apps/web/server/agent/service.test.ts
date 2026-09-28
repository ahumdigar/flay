import { describe, expect, it, vi } from 'vitest';
import { SOL_MINT, USDC_MINT } from '../../shared/constants.js';
import type { AgentPolicyInput } from '../../shared/agent.js';
import type { FuturesService } from '../futures/futures-service.js';
import type { FuturesTransactionService } from '../futures/transaction-service.js';
import type { QuoteService } from '../quote-service.js';
import type { StockService } from '../stocks-service.js';
import type { TokenService } from '../tokens.js';
import { AgentService } from './service.js';

function service() {
  const tokens = { getByMint: vi.fn().mockResolvedValue({ mint: USDC_MINT, decimals: 6, usdPrice: 1, verified: true, tradable: true }) };
  const agents = new AgentService(
    tokens as unknown as TokenService,
    {} as QuoteService,
    {} as StockService,
    {} as FuturesService,
    {} as FuturesTransactionService,
  );
  return { agents, tokens };
}

const basePolicy: AgentPolicyInput = {
  name: 'Policy test',
  products: ['convert', 'futures'],
  maxTransactionUsd: 25,
  maxDailyUsd: 30,
  maxSlippageBps: 50,
  maxFuturesLeverage: 3,
  maxOpenFuturesPositions: 2,
  allowedTokenMints: [USDC_MINT, SOL_MINT],
  allowedStockSymbols: [],
  allowedFuturesMarkets: ['SOL-PERP'],
  expiresInHours: 24,
};

function convert(amountAtomic: string, slippageBps = 50) {
  return { kind: 'convert' as const, inputMint: USDC_MINT, outputMint: SOL_MINT, amountAtomic, slippageBps };
}

describe('agent policy enforcement', () => {
  it('rejects product, token, slippage, leverage, and per-request limit violations', async () => {
    const { agents } = service();
    const created = agents.createCredential('user-1', SOL_MINT, basePolicy);

    await expect(agents.submit(created.credential, { idempotencyKey: crypto.randomUUID(), intent: { kind: 'stock', symbol: 'AAPLX', side: 'buy', amount: '1', slippageBps: 50 } }))
      .rejects.toMatchObject({ code: 'AGENT_PRODUCT_DENIED' });
    await expect(agents.submit(created.credential, { idempotencyKey: crypto.randomUUID(), intent: { ...convert('1000000'), outputMint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN' } }))
      .rejects.toMatchObject({ code: 'AGENT_TOKEN_DENIED' });
    await expect(agents.submit(created.credential, { idempotencyKey: crypto.randomUUID(), intent: convert('1000000', 100) }))
      .rejects.toMatchObject({ code: 'AGENT_SLIPPAGE_LIMIT' });
    await expect(agents.submit(created.credential, { idempotencyKey: crypto.randomUUID(), intent: { kind: 'futures-open', market: 'SOL-PERP', side: 'long', orderType: 'market', collateralAtomic: '1000000', leverageBps: 40_000, slippageBps: 50, routeChoice: 'auto' } }))
      .rejects.toMatchObject({ code: 'AGENT_LEVERAGE_LIMIT' });
    await expect(agents.submit(created.credential, { idempotencyKey: crypto.randomUUID(), intent: convert('26000000') }))
      .rejects.toMatchObject({ code: 'AGENT_TRANSACTION_LIMIT' });
  });

  it('enforces the rolling daily limit without double-counting idempotent retries', async () => {
    const { agents, tokens } = service();
    const created = agents.createCredential('user-1', SOL_MINT, basePolicy);
    const key = crypto.randomUUID();
    const first = await agents.submit(created.credential, { idempotencyKey: key, intent: convert('20000000') });
    const retry = await agents.submit(created.credential, { idempotencyKey: key, intent: convert('20000000') });
    expect(retry.id).toBe(first.id);
    expect(tokens.getByMint).toHaveBeenCalledTimes(1);
    await expect(agents.submit(created.credential, { idempotencyKey: crypto.randomUUID(), intent: convert('11000000') }))
      .rejects.toMatchObject({ code: 'AGENT_DAILY_LIMIT' });
  });
});

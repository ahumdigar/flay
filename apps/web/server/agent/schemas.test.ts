import { describe, expect, it } from 'vitest';
import { SOL_MINT, USDC_MINT } from '../../shared/constants.js';
import { agentIntentSubmissionSchema, agentPolicySchema } from './schemas.js';

const wallet = SOL_MINT;

describe('agent request contracts', () => {
  it('accepts a bounded trading policy', () => {
    const parsed = agentPolicySchema.safeParse({
      wallet,
      name: 'My agent',
      products: ['convert', 'futures'],
      maxTransactionUsd: 25,
      maxDailyUsd: 100,
      maxSlippageBps: 50,
      maxFuturesLeverage: 3,
      maxOpenFuturesPositions: 2,
      allowedTokenMints: [SOL_MINT, USDC_MINT],
      allowedStockSymbols: [],
      allowedFuturesMarkets: ['SOL-PERP'],
      expiresInHours: 24,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.approvalMode).toBe('always-ask');
  });

  it('accepts only the two explicit approval modes and rejects hidden policy fields', () => {
    const valid = {
      wallet,
      name: 'My agent',
      products: ['convert'],
      maxTransactionUsd: 25,
      maxDailyUsd: 100,
      maxSlippageBps: 50,
      maxFuturesLeverage: 3,
      maxOpenFuturesPositions: 2,
      allowedTokenMints: [SOL_MINT, USDC_MINT],
      allowedStockSymbols: [],
      allowedFuturesMarkets: [],
      expiresInHours: 24,
    };
    expect(agentPolicySchema.safeParse({ ...valid, approvalMode: 'automatic' }).success).toBe(true);
    expect(agentPolicySchema.safeParse({ ...valid, approvalMode: 'unrestricted' }).success).toBe(false);
    expect(agentPolicySchema.safeParse({ ...valid, approvalMode: 'automatic', allowFiat: true }).success).toBe(false);
  });

  it('rejects a daily limit below the per-request limit', () => {
    const parsed = agentPolicySchema.safeParse({
      wallet,
      name: 'My agent',
      products: ['stocks'],
      maxTransactionUsd: 50,
      maxDailyUsd: 25,
      maxSlippageBps: 50,
      maxFuturesLeverage: 3,
      maxOpenFuturesPositions: 2,
      allowedTokenMints: [],
      allowedStockSymbols: ['AAPLX'],
      allowedFuturesMarkets: [],
      expiresInHours: 24,
    });
    expect(parsed.success).toBe(false);
  });

  it('has no fiat, wallet-send, key-export, or arbitrary-call intent', () => {
    for (const kind of ['fiat-onramp', 'send', 'export-key', 'program-call']) {
      const parsed = agentIntentSubmissionSchema.safeParse({ idempotencyKey: crypto.randomUUID(), intent: { kind, amount: '10', program: SOL_MINT } });
      expect(parsed.success, kind).toBe(false);
    }
  });

  it('rejects hidden extra fields on an otherwise valid intent', () => {
    const parsed = agentIntentSubmissionSchema.safeParse({
      idempotencyKey: crypto.randomUUID(),
      intent: {
        kind: 'convert', inputMint: USDC_MINT, outputMint: SOL_MINT, amountAtomic: '1000000', slippageBps: 50,
        destination: 'attacker',
      },
    });
    expect(parsed.success).toBe(false);
  });
});

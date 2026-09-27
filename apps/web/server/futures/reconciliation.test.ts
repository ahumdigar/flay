import { describe, expect, it } from 'vitest';
import type {
  FuturesPrepareRequest,
  FuturesRouteQuote,
  FuturesVenuePortfolio,
} from '../../shared/futures.js';
import { reconcileFuturesAction } from './reconciliation.js';

const wallet = '11111111111111111111111111111111';
const baseRequest: FuturesPrepareRequest = {
  wallet,
  action: 'open',
  venue: 'gmtrade',
  quoteId: '811ad33d-c22f-41f9-8bcd-bbb8b9a84551',
  market: 'SOL-PERP',
  idempotencyKey: '2fcb570f-434e-4ad4-9a98-37264d6e7a76',
};
const quote: FuturesRouteQuote = {
  id: baseRequest.quoteId!,
  venue: 'gmtrade',
  market: 'SOL-PERP',
  nativeMarketAddress: wallet,
  side: 'long',
  orderType: 'limit',
  collateralAtomic: '1000000',
  notionalMicroUsd: '2000000',
  baseSizeAtomic: '20000000',
  baseDecimals: 9,
  entryPriceMicroUsd: '100000000',
  acceptablePriceMicroUsd: '100000000',
  liquidationPriceMicroUsd: null,
  openingFeeMicroUsd: '1200',
  executionFeeLamports: '300000',
  networkFeeLamports: '5000',
  accountRentLamports: null,
  immediateCostMicroUsd: '1200',
  priceImpactBps: 0,
  fundingRateBpsHourly: null,
  borrowingRateBpsHourly: null,
  setupSteps: [],
  executionEligible: true,
  exclusionCode: null,
  exclusionReason: null,
  sourceSlot: '1',
  fetchedAt: Date.now(),
  expiresAt: Date.now() + 10_000,
};
function portfolio(overrides: Partial<FuturesVenuePortfolio> = {}): FuturesVenuePortfolio {
  return {
    venue: 'gmtrade',
    available: true,
    collateralAtomic: '0',
    withdrawableAtomic: '0',
    positions: [],
    orders: [],
    orphanedConditionals: [],
    history: [],
    error: null,
    fetchedAt: Date.now(),
    ...overrides,
  };
}
const position = {
  venue: 'gmtrade' as const,
  nativeId: 'position',
  market: 'SOL-PERP',
  side: 'long' as const,
  sizeAtomic: '20000000',
  baseDecimals: 9,
  collateralAtomic: '1000000',
  entryPriceMicroUsd: '100000000',
  markPriceMicroUsd: '100000000',
  liquidationPriceMicroUsd: null,
  unrealizedPnlMicroUsd: '0',
  leverageBps: 20_000,
  conditionals: [],
  updatedAt: Date.now(),
};
const order = {
  venue: 'gmtrade' as const,
  nativeId: 'order',
  market: 'SOL-PERP',
  side: 'long' as const,
  orderType: 'limit' as const,
  sizeAtomic: '20000000',
  remainingSizeAtomic: '20000000',
  baseDecimals: 9,
  limitPriceMicroUsd: '100000000',
  reduceOnly: false,
  status: 'active',
  createdAt: null,
  updatedAt: Date.now(),
};

describe('authoritative futures reconciliation', () => {
  it('keeps a market action submitted until venue state changes', () => {
    expect(reconcileFuturesAction(baseRequest, { ...quote, orderType: 'market' }, portfolio(), portfolio())).toBeNull();
  });

  it('detects resting, partial, and filled limit entry states', () => {
    expect(reconcileFuturesAction(baseRequest, quote, portfolio(), portfolio({ orders: [order] }))?.status).toBe('resting');
    expect(reconcileFuturesAction(baseRequest, quote, portfolio(), portfolio({
      positions: [{ ...position, sizeAtomic: '5000000' }],
      orders: [{ ...order, remainingSizeAtomic: '15000000' }],
    }))?.status).toBe('partial');
    expect(reconcileFuturesAction(baseRequest, quote, portfolio(), portfolio({ positions: [position] }))?.status).toBe('filled');
  });

  it('does not attribute a different limit order to the reviewed submission', () => {
    expect(reconcileFuturesAction(baseRequest, quote, portfolio(), portfolio({
      orders: [{ ...order, nativeId: 'wrong-size', sizeAtomic: '21000000', remainingSizeAtomic: '21000000' }],
    }))).toBeNull();
    expect(reconcileFuturesAction(baseRequest, quote, portfolio(), portfolio({
      orders: [{ ...order, nativeId: 'wrong-price', limitPriceMicroUsd: '100000001' }],
    }))).toBeNull();
  });

  it('reports an undersized position increase as partial without inventing a full fill', () => {
    const result = reconcileFuturesAction(baseRequest, quote, portfolio(), portfolio({
      positions: [{ ...position, sizeAtomic: '5000000' }],
    }));
    expect(result?.status).toBe('partial');
    expect(result?.detail).toContain('15000000');
  });

  it('does not report cancellation until the native order disappears', () => {
    const request = { ...baseRequest, action: 'cancel' as const, nativeId: 'order', quoteId: undefined };
    expect(reconcileFuturesAction(request, null, portfolio({ orders: [order] }), portfolio({ orders: [order] }))).toBeNull();
    expect(reconcileFuturesAction(request, null, portfolio({ orders: [order] }), portfolio())?.status).toBe('cancelled');
  });

  it('detects partial and complete reduce-only changes', () => {
    const request = { ...baseRequest, action: 'reduce' as const, nativeId: 'position', sizeAtomic: '10000000', quoteId: undefined };
    expect(reconcileFuturesAction(request, null, portfolio({ positions: [position] }), portfolio({ positions: [{ ...position, sizeAtomic: '15000000' }] }))?.status).toBe('partial');
    expect(reconcileFuturesAction(request, null, portfolio({ positions: [position] }), portfolio({ positions: [{ ...position, sizeAtomic: '10000000' }] }))?.status).toBe('filled');
  });

  it('observes conditional creation and removal by native id', () => {
    const conditional = {
      venue: 'gmtrade' as const,
      nativeId: 'conditional',
      kind: 'take-profit' as const,
      triggerPriceMicroUsd: '110000000',
      executionPriceMicroUsd: '109500000',
      sizeAtomic: '20000000',
      orphaned: false,
      status: 'active',
    };
    const create = { ...baseRequest, action: 'take-profit' as const, nativeId: 'position', sizeAtomic: '20000000', triggerPriceMicroUsd: conditional.triggerPriceMicroUsd, executionPriceMicroUsd: conditional.executionPriceMicroUsd, quoteId: undefined };
    expect(reconcileFuturesAction(create, null, portfolio({ positions: [position] }), portfolio({ positions: [{ ...position, conditionals: [conditional] }] }))?.status).toBe('resting');
    expect(reconcileFuturesAction(create, null, portfolio({ positions: [position] }), portfolio({ positions: [position, { ...position, nativeId: 'other-position', conditionals: [conditional] }] }))).toBeNull();
    expect(reconcileFuturesAction(create, null, portfolio({ positions: [position] }), portfolio({ positions: [{ ...position, conditionals: [{ ...conditional, sizeAtomic: '19999999' }] }] }))).toBeNull();
    const cancel = { ...baseRequest, action: 'cancel-conditional' as const, nativeId: conditional.nativeId, quoteId: undefined };
    expect(reconcileFuturesAction(cancel, null, portfolio({ positions: [{ ...position, conditionals: [conditional] }] }), portfolio({ positions: [position] }))?.status).toBe('cancelled');
    const orphaned = { ...conditional, market: 'SOL-PERP', orphaned: true };
    expect(reconcileFuturesAction(cancel, null, portfolio({ orphanedConditionals: [orphaned] }), portfolio({ orphanedConditionals: [orphaned] }))).toBeNull();
    expect(reconcileFuturesAction(cancel, null, portfolio({ orphanedConditionals: [orphaned] }), portfolio())?.status).toBe('cancelled');
  });

  it('requires the exact collateral delta', () => {
    const request = { ...baseRequest, action: 'deposit' as const, venue: 'phoenix' as const, amountAtomic: '1000000', quoteId: undefined, market: undefined };
    expect(reconcileFuturesAction(request, null, portfolio({ venue: 'phoenix', collateralAtomic: '500000' }), portfolio({ venue: 'phoenix', collateralAtomic: '1499999' }))).toBeNull();
    expect(reconcileFuturesAction(request, null, portfolio({ venue: 'phoenix', collateralAtomic: '500000' }), portfolio({ venue: 'phoenix', collateralAtomic: '1500000' }))?.status).toBe('filled');
    expect(reconcileFuturesAction(request, null, portfolio({ venue: 'phoenix', collateralAtomic: '500000' }), portfolio({ venue: 'phoenix', collateralAtomic: '1500001' }))).toBeNull();
  });
});

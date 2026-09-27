import type {
  FuturesExecutionStatus,
  FuturesPrepareRequest,
  FuturesRouteQuote,
  FuturesVenuePortfolio,
} from '../../shared/futures.js';

export interface ReconciliationResult {
  status: FuturesExecutionStatus;
  detail: string;
}

function positionSize(portfolio: FuturesVenuePortfolio | null, market: string, side: 'long' | 'short'): bigint {
  return (portfolio?.positions ?? []).filter((position) => position.market === market && position.side === side)
    .reduce((total, position) => total + BigInt(position.sizeAtomic), 0n);
}

function matchingNewOrders(
  before: FuturesVenuePortfolio | null,
  after: FuturesVenuePortfolio,
  quote: FuturesRouteQuote,
) {
  const previous = new Set((before?.orders ?? []).map((order) => order.nativeId));
  const targetSize = BigInt(quote.baseSizeAtomic);
  return after.orders.filter((order) => !previous.has(order.nativeId)
    && order.market === quote.market
    && order.side === quote.side
    && order.orderType === quote.orderType
    && BigInt(order.sizeAtomic) === targetSize
    && BigInt(order.remainingSizeAtomic) <= targetSize
    && (quote.orderType !== 'limit' || order.limitPriceMicroUsd === quote.entryPriceMicroUsd));
}

export function reconcileFuturesAction(
  request: FuturesPrepareRequest,
  quote: FuturesRouteQuote | null,
  before: FuturesVenuePortfolio | null,
  after: FuturesVenuePortfolio,
): ReconciliationResult | null {
  if (!after.available) return null;

  if (request.action === 'open' && quote) {
    const beforeSize = positionSize(before, quote.market, quote.side);
    const afterSize = positionSize(after, quote.market, quote.side);
    const filledSize = afterSize > beforeSize ? afterSize - beforeSize : 0n;
    const targetSize = BigInt(quote.baseSizeAtomic);
    const pendingOrders = matchingNewOrders(before, after, quote);
    if (pendingOrders.length > 1) return null;
    const remaining = pendingOrders[0] ? BigInt(pendingOrders[0].remainingSizeAtomic) : 0n;
    if (filledSize >= targetSize) {
      return { status: 'filled', detail: request.venue + ' reports the reviewed position increase as filled.' };
    }
    if (filledSize > 0n) {
      const unfilled = remaining > 0n ? remaining : targetSize - filledSize;
      return { status: 'partial', detail: request.venue + ' reports a partial fill with ' + unfilled + ' base units unfilled.' };
    }
    if (pendingOrders.length === 1 && quote.orderType === 'limit') {
      return remaining === targetSize
        ? { status: 'resting', detail: request.venue + ' reports the exact reviewed limit order as resting on its original venue.' }
        : { status: 'partial', detail: request.venue + ' reports the reviewed limit order with ' + remaining + ' base units remaining.' };
    }
    return null;
  }

  if (request.action === 'cancel') {
    return after.orders.some((order) => order.nativeId === request.nativeId)
      ? null
      : { status: 'cancelled', detail: request.venue + ' no longer reports the cancelled order.' };
  }

  if (request.action === 'close' || request.action === 'reduce') {
    const beforePosition = before?.positions.find((position) => position.nativeId === request.nativeId);
    if (!beforePosition) return null;
    const afterPosition = after.positions.find((position) => position.nativeId === request.nativeId);
    const afterSize = BigInt(afterPosition?.sizeAtomic ?? '0');
    const beforeSize = BigInt(beforePosition.sizeAtomic);
    const requested = BigInt(request.sizeAtomic ?? beforePosition.sizeAtomic);
    if (afterSize === 0n || beforeSize - afterSize >= requested) {
      return { status: 'filled', detail: request.venue + ' confirms the reduce-only position change.' };
    }
    if (afterSize < beforeSize) {
      return { status: 'partial', detail: request.venue + ' reports a partial reduction; ' + afterSize + ' base units remain.' };
    }
    return null;
  }

  if (request.action === 'take-profit' || request.action === 'stop-loss') {
    const beforePosition = before?.positions.find((position) => position.nativeId === request.nativeId);
    const afterPosition = after.positions.find((position) => position.nativeId === request.nativeId);
    if (!beforePosition || !afterPosition) return null;
    const beforeIds = new Set(beforePosition.conditionals.map((item) => item.nativeId));
    const created = afterPosition.conditionals
      .find((item) => !beforeIds.has(item.nativeId)
        && item.kind === request.action
        && item.sizeAtomic === request.sizeAtomic
        && item.triggerPriceMicroUsd === request.triggerPriceMicroUsd
        && item.executionPriceMicroUsd === request.executionPriceMicroUsd);
    return created
      ? { status: 'resting', detail: request.venue + ' reports the conditional order as active on the original position.' }
      : null;
  }

  if (request.action === 'cancel-conditional') {
    const stillPresent = after.positions.some((position) => position.conditionals.some((item) => item.nativeId === request.nativeId))
      || after.orphanedConditionals.some((item) => item.nativeId === request.nativeId);
    return stillPresent ? null : { status: 'cancelled', detail: request.venue + ' no longer reports the conditional order.' };
  }

  if (request.action === 'deposit' || request.action === 'withdraw') {
    const beforeCollateral = BigInt(before?.collateralAtomic ?? '0');
    const afterCollateral = BigInt(after.collateralAtomic);
    const amount = BigInt(request.amountAtomic ?? '0');
    const changed = request.action === 'deposit'
      ? afterCollateral === beforeCollateral + amount
      : afterCollateral + amount === beforeCollateral;
    return changed
      ? { status: 'filled', detail: request.venue + ' confirms the collateral ' + request.action + '.' }
      : null;
  }

  return null;
}

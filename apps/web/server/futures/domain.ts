import { randomUUID } from 'node:crypto';
import type {
  FuturesIntent,
  FuturesRouteQuote,
  FuturesVenue,
  FuturesVenueMarket,
} from '../../shared/futures.js';

export const USDC_DECIMALS = 6;
export const MAX_FUTURES_LEVERAGE_BPS = 100_000;
export const FUTURES_QUOTE_TTL_MS = 10_000;
export const FUTURES_DATA_STALE_MS = 12_000;
export const ROUTE_NEAR_TIE_ABSOLUTE_MICRO_USD = 1_000n;
export const ROUTE_NEAR_TIE_RELATIVE_BPS = 1n;

export interface VenueAdapter {
  readonly venue: FuturesVenue;
  readiness(wallet?: string): Promise<{ publicData: boolean; execution: boolean; status: 'ready' | 'onboarding-required' | 'unavailable' | 'degraded'; detail: string; checkedAt: number }>;
  markets(): Promise<FuturesVenueMarket[]>;
  quote(intent: FuturesIntent, market: FuturesVenueMarket): Promise<FuturesRouteQuote>;
}

export function integerString(value: bigint): string {
  return value.toString(10);
}

export function decimalToMicroUsd(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new Error('Invalid USD value.');
  return String(Math.round(value * 1_000_000));
}

export function microUsdToNumber(value: string): number {
  return Number(BigInt(value)) / 1_000_000;
}

export function notionalForIntent(intent: FuturesIntent): bigint {
  return BigInt(intent.collateralAtomic) * BigInt(intent.leverageBps) / 10_000n;
}

export function baseSizeForNotional(notionalMicroUsd: bigint, priceMicroUsd: bigint, baseDecimals: number): bigint {
  if (priceMicroUsd <= 0n) throw new Error('A positive price is required.');
  return notionalMicroUsd * 10n ** BigInt(baseDecimals) / priceMicroUsd;
}

export function liquidationEstimate(priceMicroUsd: bigint, side: FuturesIntent['side'], leverageBps: number): bigint {
  const leverage = BigInt(leverageBps);
  const movementBps = 10_000n * 10_000n / leverage;
  const maintenanceBufferBps = 500n;
  const delta = priceMicroUsd * (movementBps > maintenanceBufferBps ? movementBps - maintenanceBufferBps : 0n) / 10_000n;
  return side === 'long' ? (priceMicroUsd > delta ? priceMicroUsd - delta : 0n) : priceMicroUsd + delta;
}

export function excludedQuote(
  venue: FuturesVenue,
  intent: FuturesIntent,
  market: FuturesVenueMarket,
  code: string,
  reason: string,
): FuturesRouteQuote {
  const notional = notionalForIntent(intent);
  return {
    id: randomUUID(), venue, market: intent.market, nativeMarketAddress: market.marketAddress,
    side: intent.side, orderType: intent.orderType, collateralAtomic: intent.collateralAtomic,
    notionalMicroUsd: notional.toString(), baseSizeAtomic: '0', baseDecimals: market.baseDecimals,
    entryPriceMicroUsd: null, acceptablePriceMicroUsd: null, liquidationPriceMicroUsd: null,
    openingFeeMicroUsd: null, executionFeeLamports: null, networkFeeLamports: null,
    accountRentLamports: null, immediateCostMicroUsd: null, priceImpactBps: null,
    fundingRateBpsHourly: market.fundingRateBpsHourly, borrowingRateBpsHourly: null,
    setupSteps: [], executionEligible: false, exclusionCode: code, exclusionReason: reason,
    sourceSlot: market.sourceSlot, fetchedAt: Date.now(), expiresAt: Date.now() + FUTURES_QUOTE_TTL_MS,
  };
}

export function compareEligibleQuotes(
  quotes: FuturesRouteQuote[],
  reliability: Partial<Record<FuturesVenue, { attempts: number; successes: number }>> = {},
): {
  venue: FuturesVenue | null;
  label: 'Best route' | 'Only available route' | 'Choose a venue' | 'No route';
} {
  const eligible = quotes.filter((quote) => quote.executionEligible);
  if (!eligible.length) return { venue: null, label: 'No route' };
  if (eligible.length === 1) return { venue: eligible[0].venue, label: 'Only available route' };
  if (eligible.some((quote) => quote.immediateCostMicroUsd === null)) return { venue: null, label: 'Choose a venue' };
  const ranked = [...eligible].sort((a, b) => {
    const cost = BigInt(a.immediateCostMicroUsd!) - BigInt(b.immediateCostMicroUsd!);
    if (cost !== 0n) return cost < 0n ? -1 : 1;
    return a.venue === 'phoenix' ? -1 : 1;
  });
  const cheapest = BigInt(ranked[0].immediateCostMicroUsd!);
  const runnerUp = BigInt(ranked[1].immediateCostMicroUsd!);
  const threshold = cheapest * ROUTE_NEAR_TIE_RELATIVE_BPS / 10_000n > ROUTE_NEAR_TIE_ABSOLUTE_MICRO_USD
    ? cheapest * ROUTE_NEAR_TIE_RELATIVE_BPS / 10_000n
    : ROUTE_NEAR_TIE_ABSOLUTE_MICRO_USD;
  if (runnerUp - cheapest <= threshold) {
    const buildReliability = (venue: FuturesVenue) => reliability[venue] ?? { attempts: 0, successes: 0 };
    const first = buildReliability(ranked[0].venue);
    const second = buildReliability(ranked[1].venue);
    const firstVerified = first.successes > 0;
    const secondVerified = second.successes > 0;
    if (firstVerified !== secondVerified) return { venue: firstVerified ? ranked[0].venue : ranked[1].venue, label: 'Best route' };
    if (firstVerified && secondVerified) {
      const difference = first.successes * second.attempts - second.successes * first.attempts;
      if (difference !== 0) return { venue: difference > 0 ? ranked[0].venue : ranked[1].venue, label: 'Best route' };
    }
    const phoenix = ranked.find((quote) => quote.venue === 'phoenix');
    if (phoenix) return { venue: phoenix.venue, label: 'Best route' };
  }
  return { venue: ranked[0].venue, label: 'Best route' };
}

import type { MarketQuote, QuoteProvider } from '../shared/types.js';
import { isAutoMarketRouteFallbackCode } from '../shared/market-routing.js';
import { AppError, asAppError } from './errors.js';

interface RouteFailure {
  provider: QuoteProvider;
  error: AppError;
}

const PROVIDER_LABELS: Record<QuoteProvider, string> = {
  jupiter: 'Jupiter',
  raydium: 'Raydium',
  orca: 'Orca',
};

function routeFailureMessage(failures: RouteFailure[]): string {
  const detail = failures.slice(0, 3).map(({ provider, error }) => {
    const label = PROVIDER_LABELS[provider];
    const message = error.message
      .replace(new RegExp(`^${label}:\\s*`, 'i'), '')
      .replace(/\s+/g, ' ')
      .slice(0, 100);
    return `${label}: ${message}`;
  }).join(' · ');
  return `No executable Convert route is available right now. ${detail || 'Refresh the routes and retry.'}`;
}

export async function prepareRankedMarketRoute<T>(
  candidates: MarketQuote[],
  prepare: (candidate: MarketQuote) => Promise<T>,
): Promise<T> {
  const failures: RouteFailure[] = [];
  const attemptedProviders = new Set<QuoteProvider>();
  for (const candidate of candidates) {
    if (attemptedProviders.has(candidate.provider)) continue;
    attemptedProviders.add(candidate.provider);
    try {
      return await prepare(candidate);
    } catch (error) {
      const appError = asAppError(error, 'MARKET_ROUTE_PREPARE_FAILED');
      if (!isAutoMarketRouteFallbackCode(appError.code)) throw appError;
      failures.push({ provider: candidate.provider, error: appError });
    }
    if (attemptedProviders.size === 3) break;
  }
  throw new AppError(409, 'AGENT_NO_EXECUTABLE_ROUTE', routeFailureMessage(failures), true);
}

import type { MarketQuote, QuoteProvider, QuoteResponse } from '../shared/types.js';
import { isAutoMarketRouteFallbackCode } from '../shared/market-routing.js';
import { ApiClientError, readableError } from './lib/api.js';

export type MarketRouteChoice = QuoteProvider | 'auto';

export function marketPrepareCandidates(
  response: QuoteResponse | null,
  selected: MarketQuote | null,
  choice: MarketRouteChoice,
): MarketQuote[] {
  if (!selected) return [];
  if (choice !== 'auto') return [selected];
  const seen = new Set<string>();
  return [selected, ...(response?.quotes ?? [])].filter((quote) => {
    if (seen.has(quote.id)) return false;
    seen.add(quote.id);
    return true;
  });
}

export function shouldTryNextMarketRoute(
  choice: MarketRouteChoice,
  error: unknown,
  candidateIndex: number,
  candidateCount: number,
): boolean {
  return isAutoMarketFallbackFailure(choice, error)
    && candidateIndex + 1 < candidateCount;
}

export function isAutoMarketFallbackFailure(choice: MarketRouteChoice, error: unknown): boolean {
  return choice === 'auto'
    && error instanceof ApiClientError
    && isAutoMarketRouteFallbackCode(error.code);
}

export function automaticPreparationFailure(
  failures: Array<{ provider: QuoteProvider; error: unknown }>,
): Error {
  const labels: Record<QuoteProvider, string> = { jupiter: 'Jupiter', raydium: 'Raydium', orca: 'Orca' };
  const summary = failures.slice(0, 3).map(({ provider, error }) => {
    const message = readableError(error).replace(/\s+/g, ' ').slice(0, 180);
    return `${labels[provider]}: ${message}`;
  }).join(' · ');
  return new Error(`Auto could not prepare an executable route. ${summary || 'Request fresh routes and retry.'}`);
}

export async function prepareMarketCandidates<T>(
  candidates: MarketQuote[],
  choice: MarketRouteChoice,
  prepare: (candidate: MarketQuote) => Promise<T>,
): Promise<T> {
  const failures: Array<{ provider: QuoteProvider; error: unknown }> = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    try {
      return await prepare(candidate);
    } catch (error) {
      failures.push({ provider: candidate.provider, error });
      if (shouldTryNextMarketRoute(choice, error, index, candidates.length)) continue;
      if (isAutoMarketFallbackFailure(choice, error)) break;
      throw error;
    }
  }
  throw automaticPreparationFailure(failures);
}

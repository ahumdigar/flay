import { decimalToAtomic } from '../shared/amounts.js';
import type { QuoteResponse } from '../shared/types.js';

/** A displayed quote may only be reviewed for the exact current form inputs. */
export function isCurrentQuoteResponse(
  response: QuoteResponse | null,
  inputMint: string,
  outputMint: string,
  amount: string,
  inputDecimals: number | undefined,
  slippageBps: number,
  now: number,
): response is QuoteResponse {
  if (!response || inputDecimals === undefined) return false;
  try {
    const atomic = decimalToAtomic(amount, inputDecimals);
    return response.inputToken.mint === inputMint
      && response.outputToken.mint === outputMint
      && response.quotes.every((quote) => (
        quote.inAmount === atomic
        && quote.slippageBps === slippageBps
        && quote.expiresAt > now
      ));
  } catch {
    return false;
  }
}

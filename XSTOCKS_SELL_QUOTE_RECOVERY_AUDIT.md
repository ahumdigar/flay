# Flay xStocks sell-quote recovery audit

**Status:** complete  
**Date:** 2026-09-27  
**Plan:** `XSTOCKS_SELL_QUOTE_RECOVERY_PLAN.md`

## Result

Valid xStocks sales now recover from one temporary Jupiter/RPC quote failure and return executable USDC proceeds. Flay no longer caches an all-provider failure or turns it into a successful empty stock quote. If the bounded retry also fails, the browser displays the real provider message and a `Retry route` action while review remains disabled.

The founder's reported input was reproduced against mainnet through the final service: `0.000091 NVDAx` became the canonical `9084` raw units and returned `0.020429 USDC` expected, `0.020327 USDC` minimum, through `Jupiter Swap V2 Router · Whirlpool` in 1.33 seconds with zero provider failures.

## Plan-to-code comparison

1. **Canonical sell path preserved — passed.** `server/stocks-service.ts` still loads fresh official xStocks detail, requires the verified token and multiplier, converts scaled display shares to raw units, fixes the output to native USDC, binds the route to the authenticated execution wallet, and requests only `jupiter` in Router mode. The existing Jupiter adapter still builds and simulates the exact transaction before exposing it.
2. **Failed quote responses are not cached — passed.** `server/quote-service.ts` adds `shouldCacheQuoteResponse` and writes to the quote cache only when at least one executable route exists. Successful cache behavior is unchanged.
3. **One bounded stock-only retry — passed.** `server/stocks-service.ts` waits 250 ms and performs exactly one fresh quote request only when the first response has no route and at least one retryable failure. Non-retryable failures, preparation, signing, and execution are never retried by this change.
4. **Provider failure propagation — passed.** After the bounded attempt, `StockService.quote` throws the provider's code and message instead of returning empty proceeds. A missing provider diagnostic receives the explicit `XSTOCKS_ROUTE_UNAVAILABLE` fallback without fabricating a route.
5. **Actionable UI and fail-closed review — passed.** `src/stocks/StocksPage.tsx` already maps API errors into `quoteError`; it now provides `Retry route`, which increments the bounded quote refresh nonce. `canReview` still requires a present, unexpired route, no active quote request, sufficient confirmed input balance, and a live catalog.
6. **Regression coverage — passed.** `server/quote-service.test.ts` covers cache eligibility. `server/stocks-service.test.ts` covers successful one-retry recovery, terminal retryable error propagation, non-retryable no-retry behavior, and scaled sell conversion. `src/stocks/StocksPage.test.tsx` covers the visible retry control and disabled review boundary.
7. **No trust-boundary regression — passed.** No mock price, sample route, fake balance, fake transaction, new secret, new environment variable, or custom Solana program was added. Existing wallet binding, canonical mint checks, exact simulation, and user-signature flow remain intact.

## Acceptance criteria evidence

1. **Exact NVDAx amount and proceeds:** live final-service evidence returned `inputRaw: 9084`, `proceedsUsdc: 0.020429`, `minimumUsdc: 0.020327`, `provider: Jupiter Swap V2 Router`, `route: Whirlpool`, and `failures: []` for the founder wallet and `0.000091 NVDAx`.
2. **Failure cache behavior:** `shouldCacheQuoteResponse` returns false for an empty all-provider failure and true for a response containing a live route; focused coverage passes.
3. **Exactly one recovery attempt:** the recovery test observes two total quote calls after a retryable initial failure and receives a live route on the second call.
4. **Honest terminal errors:** the retryable terminal test preserves `PROVIDER_TIMEOUT` and `Jupiter Router did not respond in time.` after two calls; the non-retryable simulation test preserves its error after one call.
5. **Retry and review control:** the UI regression test confirms `Retry route`, the quote refresh action, and the existing `!canReview` disable condition.
6. **Authentic execution boundary:** source review and release scan find no alternate stock provider, locally generated quote, or fake fallback in the changed path.
7. **Quality gates:** all checks below passed against the final production implementation and final focused tests.

## Verification record

- Focused regression suite: 3 files and 33 tests passed.
- Full Vitest suite: 42 files passed, 4 skipped; 260 tests passed, 8 skipped.
- TypeScript and production Vite build: passed.
- Release source and browser-bundle audit: passed across 246 bundle files.
- Browser audit: passed desktop and mobile Stocks checks, initial price visibility, featured selection, full-catalog search, responsive overflow checks, and reported zero runtime exceptions.
- Shipped-path placeholder scan: no TODO, FIXME, mock quote, fake data, or preview-only execution path found; matches were ordinary HTML input placeholders.
- Local server restart: updated backend process is active at `http://127.0.0.1:5173`.
- Local health after catalog warmup: `status: ok`; xStocks, RPC, and Jupiter Swap ready; 1,124 official Solana xStocks loaded with a complete directory.
- Mainnet quote evidence: the exact founder NVDAx sell request succeeded through the final `StockService` in 1.33 seconds with no provider failures.

## Remaining user action

No configuration change is required. Reload the local Stocks page and retry the sale. If Jupiter has a temporary outage, Flay retries once; if it remains unavailable, the ticket now shows the actual error and a manual retry action instead of the misleading empty waiting state.

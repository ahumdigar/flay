# Flay xStocks asset-detail reliability fix

**Status:** complete — see `XSTOCKS_DETAIL_RELIABILITY_FIX_AUDIT.md`  
**Date:** 2026-09-26  
**Scope:** prevent the Stocks asset-detail screen from waiting indefinitely when xStocks reference prices are slow

## Observed fault

The Stocks page can remain on `Verifying official asset` because `loadDetail` treats the xStocks issuer reference-price endpoint as mandatory. On 2026-09-26, the canonical AAPLx asset and multiplier endpoints returned normally, while `/price-data` timed out. The existing generic retry caused the detail API to take about twenty seconds before it could return an error.

## Implementation

1. Preserve strict canonical asset, Solana mint, multiplier, Token-2022, and Jupiter-route verification. A failure of any execution-critical check must still fail closed.
2. Treat the issuer reference price as optional display data. Give it one short, non-retried attempt; use the separately reviewed live-price fallback when it is available, otherwise return `referencePrice: null` and show `Unavailable` rather than inventing a price.
3. Give execution-critical detail calls one bounded, non-retried timeout and limit background list reference-price probes, avoiding a price-request burst that competes with the selected asset.
4. Add a browser-side detail request deadline. It must cancel the pending request, stop the spinner, explain the timeout, and leave the existing Retry action available.
5. Add tests for the optional-price timeout path and visible retryable timeout state. Run focused tests, the full quality check, release audit, browser audit, and a live local AAPLx detail request.

## Acceptance criteria

1. With an unavailable price-data endpoint but valid canonical asset, multiplier, and mint, `/api/stocks/AAPLx` remains usable with a separately verified live market reference when available, or null reference fields when neither verified price source responds.
2. A failed asset, multiplier, mint, or onchain Token-2022 validation cannot produce a tradable stock asset or Jupiter quote.
3. Each detail request uses bounded no-retry provider attempts; list pricing makes only a small bounded number of optional price requests.
4. The browser cannot remain on `Verifying official asset` indefinitely. It reaches a retryable error state within the client deadline.
5. No price, mint, balance, route, quote, or receipt is synthesized when a provider value is unavailable.
6. The completion audit maps all acceptance criteria to final code and successful verification before the fix is declared complete.

# Flay xStocks sell-quote recovery

**Status:** complete — see `XSTOCKS_SELL_QUOTE_RECOVERY_AUDIT.md`  
**Date:** 2026-09-27  
**Scope:** restore executable Jupiter proceeds for valid xStocks sales and make provider failures recoverable

## Observed fault

The Stocks ticket accepts a valid stock amount but can remain on `WAITING`, show no estimated USDC proceeds, and tell the user to enter an amount. For the founder's exact report, `0.000091 NVDAx`, the scaled amount is `9084` raw units and Jupiter currently builds and simulates an executable route returning about `0.020427 USDC`. The route is therefore being hidden by Flay's empty-provider-response path rather than rejected for dust or missing liquidity.

## Implementation plan

1. Preserve the existing canonical xStocks mint, scaled-UI conversion, wallet binding, Token-2022 validation, Jupiter-only execution, and exact transaction simulation.
2. Do not cache a quote aggregation result when every requested provider failed. A temporary Jupiter or RPC failure must be eligible for a fresh provider attempt rather than replayed from the quote cache.
3. For a stock quote only, retry one time after a short bounded delay when the sole Jupiter failure is marked retryable. Do not retry validation failures, non-retryable failures, transaction preparation, signatures, or execution.
4. If no executable stock route exists after the bounded retry, return the real provider failure as an API error. Never turn a provider failure into a successful response with empty proceeds.
5. In the Stocks ticket, show the returned route error and an explicit `Retry route` action. Keep the review action disabled until a current executable quote exists.
6. Add regression coverage for failed-response cache behavior, one-time stock recovery, terminal error propagation, and the visible retry action.
7. Verify the exact founder NVDAx sale through the real service, run focused and full tests, TypeScript/production build, release audit, browser audit, and local health. Then compare every criterion with final code in a completion audit.

## Acceptance criteria

1. `0.000091 NVDAx` converts to the canonical `9084` raw input and a live service request returns executable USDC proceeds when Jupiter is healthy.
2. An all-provider failure is not stored in the quote cache, while successful quote caching remains unchanged.
3. A retryable first Jupiter failure receives exactly one fresh stock-quote retry and can recover to an executable response.
4. A second retryable failure, or any non-retryable failure, reaches the browser with its real provider message; Flay does not show an empty successful quote or misleading amount prompt.
5. The Stocks UI exposes `Retry route`, refreshes through the existing bounded quote path, and cannot enable review without a live unexpired route and sufficient confirmed balance.
6. No fake price, route, balance, or transaction is introduced; wallet binding and the reviewed Jupiter transaction trust boundary remain intact.
7. Focused tests, the full check, release scan, browser audit, exact live NVDAx service evidence, local health, and the final plan-to-code audit pass before completion is declared.

## Completion rule

Do not mark this correction complete until `XSTOCKS_SELL_QUOTE_RECOVERY_AUDIT.md` maps every acceptance criterion to final code and verification evidence.

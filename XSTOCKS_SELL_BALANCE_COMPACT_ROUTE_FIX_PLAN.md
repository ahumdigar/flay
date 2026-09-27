# Flay xStocks sell-balance and compact-route correction

**Status:** complete — see `XSTOCKS_SELL_BALANCE_COMPACT_ROUTE_FIX_AUDIT.md`  
**Date:** 2026-09-27  
**Scope:** reject impossible stock sell inputs locally and recover from rent-heavy Jupiter stock routes

## Observed fault

The Stocks sell ticket defaults to `0.01` shares even when the confirmed holding is smaller. In the founder screenshot, the input is `0.01 AAPLx` while the confirmed display balance is only `0.00038246 AAPLx`. Flay still asks Jupiter to build the impossible trade, and the first two-hop route fails earlier while creating a rent-bearing account, producing a confusing `0.000333453 SOL more for account rent` message.

The wallet currently has `0.001163493 SOL` and `38121` raw AAPLx units. A live Jupiter request with the existing 32-account cap selected a two-hop route with two setup instructions and failed simulation for rent. A second request capped at 20 accounts selected a direct Raydium CLMM route with one setup instruction; that exact transaction simulated successfully with the wallet's current balances.

## Implementation plan

1. Convert the entered scaled stock display amount to raw units in the browser and compare it with the confirmed canonical stock-token balance before requesting a route.
2. When Sell is selected, initialize the ticket with the available scaled stock balance instead of the unrelated fixed `0.01` amount.
3. Keep review disabled and show the existing confirmed-balance error whenever the entered sell amount exceeds the holding; do not call Jupiter until the input becomes affordable.
4. Keep Jupiter's 32-account route as the first choice. If and only if exact simulation reports `INSUFFICIENT_SOL` for account rent, request one bounded compact fallback with `maxAccounts=20` and simulate it.
5. Return and later prepare the exact compact transaction and quote when it succeeds. Do not retry for insufficient token balance, malformed provider data, slippage, arbitrary simulation failures, preparation, signing, or execution.
6. Add focused tests for scaled client-side balance comparison, sell-tab amount initialization, compact-fallback eligibility, and preserved route request bounds.
7. Verify the founder wallet's full AAPLx holding against live Jupiter, run focused and full tests, TypeScript/production build, release audit, browser audit, and local health, then write a plan-to-code completion audit.

## Acceptance criteria

1. An entered `0.01 AAPLx` is recognized as greater than the confirmed `38121` raw-unit holding and cannot issue a stock quote or enable review.
2. Selecting Sell fills the ticket with the current scaled AAPLx balance when balances are available.
3. The normal Router request still uses `maxAccounts=32`; only an `INSUFFICIENT_SOL` assembly result can cause one `maxAccounts=20` fallback request.
4. Other provider, validation, balance, or simulation failures remain fail-closed and are not retried as compact routes.
5. The founder wallet's full AAPLx balance produces a live, simulated, direct executable route using its current SOL balance.
6. The final quote, minimum output, route label, transaction bytes, wallet binding, and later review all come from the same successful compact Jupiter build. No quote or transaction is fabricated.
7. Focused tests, full checks, release scan, browser audit, local health, live mainnet evidence, and the completion audit pass before completion is declared.

## Completion rule

Do not mark this correction complete until `XSTOCKS_SELL_BALANCE_COMPACT_ROUTE_FIX_AUDIT.md` maps every acceptance criterion to final code and verification evidence.

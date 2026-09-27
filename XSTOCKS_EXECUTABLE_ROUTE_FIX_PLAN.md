# Flay xStocks executable-route reliability fix

**Status:** implementation complete; evidence in `XSTOCKS_EXECUTABLE_ROUTE_FIX_AUDIT.md`  
**Date:** 2026-09-24  
**Scope:** xStocks quote-to-review boundary only

## Problem

Stocks currently requests a Jupiter Swap V2 price without the authenticated wallet and labels that result `LIVE`. Review then requests a wallet-bound order. Jupiter can price an amount that it cannot build for that wallet because of balance, gas, associated-token-account, or gasless-minimum requirements. For a `0.01 USDC` AAPLx purchase from the founder wallet, the quote-only request returned a price while the wallet-bound request failed. Supplying custom slippage also changed Jupiter's useful `Minimum $5 for gasless` response into the vague `Failed to get quotes` response.

## Implementation

1. Extend the internal Jupiter quote request with an optional authenticated execution wallet and an explicit Meta-Aggregator or Router mode.
2. Scope the quote cache and in-flight deduplication key by execution wallet and Jupiter mode so one wallet can never receive another wallet's executable route.
3. Make xStocks use the wallet-bound Jupiter Swap V2 Router `/build` path. This avoids the Meta-Aggregator's `$5` automatic-gasless minimum for the reproduced small xStock order while retaining Jupiter Metis routing and the user's selected slippage.
4. Validate the Router response, assemble its bounded instructions and lookup tables into a v0 transaction, simulate to set a bounded compute-unit limit, and reject the route before it reaches the UI if it cannot be built or simulated.
5. Preserve the selected wallet-bound Router transaction through the existing expiring quote snapshot and reuse that exact transaction during preparation. Continue to run Flay's signer, fee-payer, program, mint, amount, minimum-output, simulation, and authenticated-wallet validation before Privy approval.
6. Keep Convert behavior unchanged: public Convert quotes may remain quote-only and are rebuilt against the wallet during Review.
7. Update Stocks copy so it identifies the executable Jupiter Metis Router path and truthfully displays the requested/provider-returned slippage.
8. Add regression tests for wallet propagation, cache isolation, non-executable order rejection, Jupiter error mapping, and exact prepared-order reuse.
9. Update the live read-only xStocks test so a passing route must contain a wallet-bound executable transaction. Record small-balance/minimum evidence without signing or spending.

## Acceptance criteria

1. Stocks never labels a quote `LIVE` unless Jupiter built a non-empty transaction for the authenticated wallet and exact amount.
2. A quote belonging to one wallet cannot be reused or prepared by another wallet.
3. The reproduced `0.01 USDC → AAPLx` request uses the Router path instead of failing at the Meta-Aggregator's `$5` gasless minimum; a genuine SOL/rent shortfall remains explicit and actionable.
4. Stocks sends and displays its chosen slippage and the provider-returned minimum output truthfully.
5. Review reuses the still-valid wallet-bound Jupiter Router transaction that produced the displayed stock quote and still passes every existing transaction-security and simulation check.
6. Convert, Futures, Funds, Activity, MagicBlock, gasless boundaries, and wallet export remain unchanged and pass regression tests.
7. Focused tests, full tests, type checking, production build, release audit, browser audit, local health, and opt-in live read-only verification pass.
8. `XSTOCKS_EXECUTABLE_ROUTE_FIX_AUDIT.md` compares every criterion with the final code before this fix is declared complete.

## Completion rule

Do not declare this fix complete until all eight criteria are mapped to actual code and current verification evidence. A live user spend is never automated; read-only proof must verify whether Jupiter returned a transaction for the exact wallet and amount.

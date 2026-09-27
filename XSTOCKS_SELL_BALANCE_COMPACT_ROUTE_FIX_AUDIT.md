# Flay xStocks sell-balance and compact-route completion audit

**Status:** complete  
**Date:** 2026-09-27  
**Plan:** `XSTOCKS_SELL_BALANCE_COMPACT_ROUTE_FIX_PLAN.md`

## Plan-to-code comparison

1. **Reject a scaled sell amount above the confirmed holding before quoting — passed.**
   - `apps/web/src/stocks/StocksPage.tsx:67-78` converts the entered scaled display amount through the shared canonical `scaledDecimalToAtomic` path and compares raw integers.
   - `apps/web/src/stocks/StocksPage.tsx:227-260` performs the comparison independently of route availability and exits before scheduling `/stocks/quotes` when the amount is unaffordable.
   - `apps/web/src/stocks/StocksPage.test.tsx:9-12` proves that `0.01 AAPLx` exceeds `38121` raw units while `0.00038246 AAPLx` does not.

2. **Initialize Sell from the actual scaled stock balance — passed.**
   - `apps/web/src/stocks/StocksPage.tsx:227-232` derives the display balance from the canonical raw token amount, token decimals, and live issuer multiplier.
   - `apps/web/src/stocks/StocksPage.tsx:392-400` fills Sell and Use balance from that derived balance instead of the old fixed `0.01` value.

3. **Keep review disabled and explain the confirmed-balance boundary — passed.**
   - `apps/web/src/stocks/StocksPage.tsx:283-285` includes the balance result in the review gate.
   - `apps/web/src/stocks/StocksPage.tsx:402-425` shows the maximum confirmed amount, hides estimated proceeds without a route, and keeps review disabled.

4. **Use one compact fallback only for exact SOL-rent simulation failure — passed.**
   - `apps/web/server/providers/jupiter.ts:108-133` keeps the normal cap at 32, the compact cap at 20, and returns the fallback cap only for `AppError` code `INSUFFICIENT_SOL`.
   - `apps/web/server/providers/jupiter.ts:340-376` simulates the exact assembled wallet-bound transaction before accepting it.
   - `apps/web/server/providers/jupiter.ts:449-476` attempts 32 once and, only for that classified rent failure, attempts 20 once. A second failure propagates; there is no loop or broad catch.
   - `apps/web/server/providers/jupiter.test.ts:69-98` proves the narrow error classification and preserved normal `maxAccounts=32` request.

5. **Preserve fail-closed behavior for all other failures — passed.**
   - The eligibility test covers token insufficiency, generic simulation failure, and ordinary errors; all return no compact fallback.
   - Existing build validation still rejects mismatched mints/amounts, unexpected tips, malformed instructions, oversized transactions, and failed exact simulation before a transaction can reach review.

6. **Keep the quote and later prepared transaction from the same successful build — passed.**
   - `apps/web/server/providers/jupiter.ts:463-475` stores the successful compact provider payload and its exact serialized transaction in one router snapshot and normalizes the public quote from that payload.
   - `apps/web/server/providers/jupiter.ts:488-503` deserializes that stored transaction for preparation, enforces the original execution wallet, and derives the final route/pools from the same stored payload. No value or transaction is fabricated.

7. **Live founder-wallet route and complete verification — passed.**
   - Screenshot diagnosis: the requested `0.01 AAPLx` was about 26 times the displayed `0.00038246 AAPLx` holding. Live RPC balances were `38121` raw AAPLx and `0.001163493 SOL`.
   - A live quote for the complete `38121` raw AAPLx holding and wallet `FexVXRLxhSgV2yW2VSJ54WQ3T58KQUr2Kikvr43nLMc7` first encountered the classified rent-heavy path, then produced an exactly simulated `Raydium CLMM` compact route: `129921` raw USDC output, `129272` minimum output, and a 603-byte serialized transaction bound to that wallet.
   - Focused verification: 3 files and 33 tests passed.
   - Full verification: 42 test files passed, 4 skipped; 262 tests passed, 8 skipped.
   - TypeScript and production build passed after the implementation.
   - Release audit passed with 246 browser bundle files scanned.
   - Browser audit passed on desktop and mobile Stocks, reported no horizontal overflow for Stocks, and reported zero runtime exceptions. The earlier Chromium `Promise was collected` harness failure disappeared on the clean rerun.
   - Shipped-path marker scan found only HTML input `placeholder` attributes; there are no TODO, FIXME, preview-only, or unimplemented markers in the changed path.
   - The supervised local server was restarted with the new adapter. `/api/health` returned `status: ok`; xStocks returned `status: ready` with 1,124 official Solana deployments; Jupiter, RPC, Privy, MagicBlock, and both futures providers reported ready for their configured scopes.

## Result

Every numbered requirement and acceptance criterion in the plan maps to shipped code and passing evidence. The screenshot failure is corrected: an oversized sale is stopped locally with the real confirmed balance, while an affordable AAPLx sale can automatically recover from a rent-heavy Jupiter build through one exact, simulated compact route.

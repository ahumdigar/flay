# Flay Convert automatic preparation fallback audit

**Status:** implementation verified; founder-wallet funding gate remains open  
**Date:** 2026-09-27  
**Plan:** `CONVERT_AUTO_PREPARE_FALLBACK_FIX_PLAN.md`

## Plan-to-code comparison

1. **Ranked Auto candidates — passed.**
   - `apps/web/src/market-prepare.ts` constructs the candidate list from the selected best quote followed by the remaining response order and removes duplicate quote IDs.
   - `apps/web/src/App.tsx` passes the exact current response and route choice into that flow when Review is pressed.

2. **Venue-local fallback — passed in deterministic execution tests.**
   - Auto advances only for a bounded allowlist of provider connectivity, rate-limit, route-unavailable, build-unavailable, gasless-minimum, blockhash, and slippage codes.
   - The exact screenshot response, `PROVIDER_REJECTED: Failed to get quotes`, is eligible even when Jupiter labels the HTTP rejection non-retryable.
   - The preparation-flow test proves Jupiter failure then Raydium success, in order, with no Orca call after success.

3. **Manual venue isolation — passed.**
   - A manual selection yields one candidate. The test proves a manual Jupiter rejection is returned directly and never switches provider.

4. **Fail closed for wallet and transaction-safety failures — passed.**
   - Input balance, SOL/rent, identity, wallet mismatch, malformed transaction, structural validation, and unclassified errors are absent from the fallback allowlist.
   - The test proves `INSUFFICIENT_SOL` ends Auto immediately. Existing server validation and simulation gates remain unchanged.

5. **Exact SOL affordability — passed in code and live simulation.**
   - `apps/web/server/quote-service.ts` prechecks the exact market input principal with a zero speculative reserve, then still requires the freshly built provider transaction to pass structure validation and Solana simulation before signing.
   - The unit boundary proves `0.001 SOL` principal passes for the observed `0.001163493 SOL` balance while an input above the balance fails.
   - Live simulation then remains authoritative and reported the real route rent shortfall instead of allowing review.

6. **One-provider review and execution — passed.**
   - `prepareMarketCandidates` returns only the first successful `PreparedTransaction`. The application registers and reviews that complete response without copying price, transaction, fee, or provider fields from a failed venue.
   - Existing server preparation binds the exact transaction to the authenticated wallet, provider, input, minimum output, programs, pools, signers, and gas mode.

7. **Bounded all-route error — passed.**
   - Exhausted eligible failures are limited to three known provider labels and 180 normalized characters per user-safe API message. No raw response, request, identity token, or transaction is included.

8. **Checks and live evidence — funding gate remains open.**
   - Focused verification: 3 files and 18 tests passed.
   - Full verification: 43 files passed, 4 skipped; 270 tests passed, 8 skipped.
   - TypeScript and production build passed; Vite transformed 7,704 modules.
   - Release audit passed with 246 browser bundle files scanned.
   - Browser audit passed with zero runtime exceptions and Convert visible in the shell regression.
   - Changed-path scan found only normal HTML input `placeholder` attributes and no TODO, FIXME, preview-only, or unimplemented markers.
   - Local `/api/health` returned `status: ok`; the supervised app responds at `http://127.0.0.1:5173`.
   - Live founder-wallet replay for `0.001 SOL` to USDC loaded all three venues. Jupiter reproduced `Failed to get quotes`; Raydium exact simulation reported that the current `0.001153221 SOL` wallet balance needs `0.00035022 SOL` more for account rent; Orca had no direct quote at that size. A second `0.0005 SOL` replay reached the same required rent boundary. No transaction was signed or submitted.

## Open acceptance gate

The code and deterministic fallback behavior pass, but the founder wallet cannot produce a valid live review for the reported native-SOL conversion with its present balance. Add at least `0.00035022 SOL` plus a small network-fee buffer (approximately `0.0004 SOL` total is practical), then rerun the same conversion. Until that live unsigned review succeeds, this correction remains active and is not declared complete.

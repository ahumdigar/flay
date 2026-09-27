# Flay Privy MoonPay fallback fix audit

**Status:** implementation complete; authenticated provider acceptance remains user-operated  
**Date:** 2026-09-24  
**Plan:** `PRIVY_MOONPAY_FALLBACK_FIX_PLAN.md`

## Result

Flay no longer leaves MoonPay hidden behind Privy's automatic Stripe-first route. The isolated production checkout now exposes automatic Privy routing and an explicit `Open MoonPay directly` action. If Privy's automatic flow returns a Stripe-unavailable rejection to Flay, the application invokes the same MoonPay-preferred flow automatically once.

The fallback uses Privy's Solana wallet-funding API with `asset: 'USDC'`, `chain: 'solana:mainnet'`, `defaultFundingMethod: 'card'`, and `preferredProvider: 'moonpay'`. The authenticated embedded wallet address is the only destination. Privy and MoonPay continue to own provider availability, quotes, KYC, payment data, and settlement.

## Plan-to-code comparison

1. **Automatic routing preserved — PASS.** `apps/web/src/PrivyRoot.tsx:134-137` still invokes `useFiatOnramp().fund` with the existing production destination options as the normal path.
2. **One Stripe-to-MoonPay retry — PASS.** `apps/web/src/privy-fiat-onramp.ts:151-158` detects only Stripe availability/region failures and calls the supplied MoonPay fallback once. Unrelated declines and errors are rethrown.
3. **Direct MoonPay action — PASS.** `apps/web/src/fiat/PrivyOnrampCheckoutPage.tsx:81-90` renders separate automatic and MoonPay controls. This works even when Privy's modal retains its Stripe error internally instead of rejecting its promise.
4. **Destination and privacy boundary — PASS.** `apps/web/src/privy-fiat-onramp.ts:119-137` builds a validated Solana-mainnet USDC request, and `apps/web/src/PrivyRoot.tsx:124-137` binds it to the authenticated embedded wallet. No provider secret, payment field, card number, phone number, or KYC payload is handled by Flay.
5. **Focused verification — PASS.** `apps/web/src/privy-fiat-onramp.test.ts` covers the automatic destination, MoonPay-preferred request, authenticated wallet binding, exact one-time fallback, non-Stripe errors, cancellation copy, and Stripe recovery copy.
6. **Application regression verification — PASS.** Type checking, production build, 227 full-suite tests, release scan, and local health passed. The complete browser audit passed after the fallback implementation with no application runtime exceptions. The final onramp-only audit then verified the final button copy and layout at 900×900 and 390×844. An additional repeated full audit later reached an unrelated temporary xStocks HTTP 429 while waiting for Apple detail; the Funds-specific audit and local Privy health remained green.

## Verification evidence

- `npm test -- src/privy-fiat-onramp.test.ts src/App.test.tsx` — 2 files and 20 tests passed.
- `npx tsc --noEmit` — passed.
- `npm test` — 41 files passed, 4 skipped; 227 tests passed, 8 skipped.
- `npm run build` — passed; Vite transformed 7,704 modules and emitted both Privy fiat-onramp and MoonPay status chunks.
- `npm run release:audit` — passed; 249 bundle files checked.
- `npm run browser:audit` — full application audit passed after implementation, including desktop/mobile Funds and isolated checkout checks with no runtime exceptions.
- `npm run browser:audit:onramp` — final desktop/mobile production checkout passed: automatic route visible, direct MoonPay visible, native Solana USDC destination visible, original-tab isolation visible, no horizontal overflow, and no runtime exceptions.
- `GET /api/health` — `status: ok`, Privy ready, production onramp, USDC on Solana.
- Shipped-path scan found no TODO, FIXME, mock provider, placeholder provider, hardcoded Stripe-only action, card/KYC collection, or provider secret.

## User-operated acceptance boundary

Automated checks do not start a real MoonPay KYC/payment session or authorize a purchase. The founder can now select **Open MoonPay directly** in the isolated checkout to verify current MoonPay availability for their real identity and region without entering Stripe first.

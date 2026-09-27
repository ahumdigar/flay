# Flay Privy MoonPay fallback fix

**Status:** superseded on 2026-09-24 by `PRIVY_AUTOMATIC_ONRAMP_ROUTING_RESTORE_PLAN.md`; retained as historical evidence  
**Date:** 2026-09-24

## Problem

The production Add Funds flow currently enters Privy's automatic card-onramp route and can stop at a regional Stripe-unavailable screen even when MoonPay is enabled. The installed Privy SDK's public `useFiatOnramp` options do not expose a provider override, while its established `useFundWallet` flow supports MoonPay as an explicit preferred card provider for Solana wallet funding.

## Implementation

1. Preserve Privy's automatic Stripe, Meld, MoonPay, and Coinbase routing as the primary checkout.
2. Add a MoonPay-specific Privy fallback that targets the same authenticated Solana wallet and USDC asset, with `preferredProvider: 'moonpay'`.
3. Automatically invoke that fallback when the primary Privy promise rejects with a Stripe-unavailable error.
4. Add an always-visible `Use MoonPay instead` action in the isolated checkout because provider-owned modal errors may remain inside Privy's UI and never reach Flay's promise boundary.
5. Keep payment, KYC, regional eligibility, quotes, and private data entirely inside Privy's provider UI.
6. Keep the original Flay trading tab isolated from provider stalls and preserve all non-fiat app behavior.

## Acceptance criteria

1. The normal checkout still uses Privy's current automatic provider routing.
2. A Stripe-unavailable rejection triggers one MoonPay-preferred retry without looping.
3. The isolated checkout lets the user launch MoonPay directly without first entering Stripe.
4. Both paths bind the authenticated embedded Solana wallet and native Solana USDC destination; no provider secret or card/KYC data enters Flay.
5. Focused tests cover provider selection, fallback detection, destination configuration, cancellation, and error copy.
6. Type checking, production build, full tests, release audit, browser audit, and local health pass with no regression.

## Completion rule

Compare all six criteria with final code and current verification evidence in `PRIVY_MOONPAY_FALLBACK_FIX_AUDIT.md` before declaring this fix complete.

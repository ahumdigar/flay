# Flay Privy automatic onramp routing restore

**Status:** failed live acceptance on 2026-09-24; superseded by `PRIVY_REGION_ROUTING_CORRECTION_PLAN.md`  
**Date:** 2026-09-24  
**Scope:** Privy Add Funds provider routing only

## Problem

Flay previously opened Privy's normal card-onramp flow and allowed Privy to select an available provider for the user's region. The repository's own production evidence records that the working build used `@privy-io/react-auth` 3.42.0 and reached both Stripe's regional response and MoonPay's KYC flow. The dependency is now pinned to 3.44.0, and a later workaround added manual automatic/MoonPay choices through the legacy `useFundWallet` API. That workaround changed the working product behavior and can force or expose a provider choice instead of preserving Privy's automatic routing.

## Implementation

1. Pin `@privy-io/react-auth` to the previously verified 3.42.0 release in the web package and lockfile.
2. Use only Privy's supported `useFiatOnramp().fund(...)` path for card funding, bound to the authenticated embedded Solana wallet, Solana mainnet, and native USDC.
3. Remove the legacy `useFundWallet` MoonPay override, provider-selection parameter, Stripe-error retry logic, and manual MoonPay action.
4. Restore one `Continue to provider` action in the isolated checkout window. Privy's onramp owns regional eligibility, provider selection, payment, KYC, and fallback behavior.
5. Preserve the isolated checkout window so a stalled or closed provider modal cannot freeze the main Flay trading tab.
6. Preserve all existing destination checks, request-bound completion messages, balance refresh, disclosure copy, and non-fiat behavior.

## Acceptance criteria

1. The installed and locked Privy React version is exactly 3.42.0, matching Flay's recorded working provider-routing build.
2. The shipped Add Funds path calls `useFiatOnramp().fund(...)` once and contains no manual Stripe/MoonPay selection, no preferred-provider override, and no legacy `useFundWallet` funding call.
3. The checkout presents one provider-launch action and explains that Privy chooses an available provider for the user's region.
4. The funding destination remains the authenticated embedded Solana wallet on Solana mainnet with native USDC selected.
5. Payment, KYC, regional eligibility, provider quotes, and private payment data remain entirely inside Privy's provider flow.
6. Focused tests, full tests, TypeScript, production build, release audit, targeted browser audit, and local health pass without changing Convert, Futures, Stocks, Activity, wallet export, or gasless boundaries.

## Completion rule

Do not declare this restoration complete until all six criteria are compared with the actual repository and recorded in `PRIVY_AUTOMATIC_ONRAMP_ROUTING_RESTORE_AUDIT.md`. Live regional provider availability remains controlled by Privy and its providers; Flay must not claim that a specific provider is available until the provider flow shows it for that user and region.

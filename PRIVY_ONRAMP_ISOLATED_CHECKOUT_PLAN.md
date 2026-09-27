# Privy onramp isolated-checkout recovery plan

**Status:** active reliability addendum  
**Parent plan:** `HACKATHON_PRIVY_FIAT_ONRAMP_PLAN.md`

## Problem

Privy's embedded Stripe/MoonPay flow owns a full-screen modal. A provider SMS or KYC step can remain pending indefinitely, which blocks every Flay navigation control in that browser tab even though Flay's server and trading APIs remain healthy.

## Design

1. Funds opens a dedicated same-origin Flay checkout tab with only validated fiat and amount in its URL.
2. The checkout tab loads the existing authenticated Privy session and requires a deliberate **Continue to provider** click.
3. The existing bridge continues to bind the authenticated embedded wallet, native Solana USDC mint, exact Solana mainnet CAIP-2 chain, and configured environment. No destination data comes from the URL.
4. Privy's modal and provider flow run only in the checkout tab. If SMS, KYC, or provider UI stalls, the user can close that tab while the original Flay trading tab remains usable.
5. A real Privy `submitted` or `confirmed` result is sent to the original same-origin tab through `BroadcastChannel`; the original tab validates the message, shows the result, and refreshes the authoritative USDC balance.
6. Returning focus to the original tab also refreshes balance after a checkout was opened. No purchase, settlement, or transaction is fabricated.

## Acceptance criteria

1. A valid Funds action opens a separate checkout tab synchronously from the user gesture.
2. Invalid fiat or amount cannot create a checkout intent.
3. Wallet, mint, chain, and environment remain bridge-controlled and absent from checkout URL input.
4. Checkout requires authenticated wallet readiness and a deliberate provider-launch action.
5. A stuck provider modal cannot cover or disable the original Flay tab.
6. Only validated `submitted` or `confirmed` messages for the current wallet update Funds state.
7. Returning to Funds refreshes the Solana balance without claiming success.
8. Popup blocking, cancellation, provider failure, and manual tab closure remain recoverable.
9. Desktop/mobile layout, focused tests, full tests, production build, release audit, and browser audit pass.
10. The parent completion audit records the live Stripe SMS stall and this recovery behavior; criterion 15 remains open until a real provider result is observed.

## Completion rule

Do not claim the fiat block complete until every criterion above maps to code and verification evidence and the parent plan's live `submitted`/`confirmed` criterion is satisfied.

# Flay Privy regional provider routing correction

**Status:** complete after authenticated founder acceptance  
**Date:** 2026-09-24  
**Scope:** production Add Funds provider selection

## Proven failure

The founder's production screenshot at `/storage/emulated/0/hackthon/jjhgb.jpg` shows that Privy's `useFiatOnramp` quote modal selected Stripe alone, returned `Stripe onramp is not available for USD in this region`, disabled Continue, and did not move to MoonPay. Downgrading to the previously used SDK version did not change this live provider response. Flay must therefore choose the appropriate Privy funding path before opening the provider modal.

## Implementation

1. Keep one Flay `Continue to provider` action and perform provider-path selection automatically before opening Privy.
2. Resolve the browser's current public-IP country and region through a bounded CORS request with a short timeout, validate only the country/region strings, cache the result for the checkout session, and never retain or log the IP address.
3. Use Privy's current `useFiatOnramp` quote flow in sandbox and in Stripe's documented onramp regions: the United States except New York, the European Union, and Serbia.
4. Outside those Stripe regions, or when region lookup fails, use Privy's Solana `useFundWallet` card flow with native USDC and MoonPay preferred. The selection remains automatic; Flay exposes no provider-choice button.
5. Bind both paths to the authenticated embedded Solana wallet. The Stripe path retains the exact Solana mainnet native-USDC destination, selected fiat, and amount. The MoonPay path uses Solana mainnet USDC and pre-fills an amount only for USD because the legacy funding API expresses the amount in the destination asset.
6. Do not fabricate a fiat submission result. The MoonPay funding flow has no authoritative submitted/confirmed result, so closing it produces an honest provider-exited state and triggers a wallet-balance refresh rather than a purchase-submitted claim.
7. Preserve the isolated checkout tab, payment/KYC custody boundary, request-bound cross-tab messages, and every non-fiat product boundary.

## Acceptance criteria

1. Bangladesh, Singapore, UAE, and unknown lookup results automatically select the MoonPay funding path; EU, Serbia, and supported US results select the Privy quote path; New York selects MoonPay.
2. One click launches the selected path with no Stripe/MoonPay buttons and no user-facing provider selector in Flay.
3. The reproduced Bangladesh route cannot enter the Stripe-only unavailable screen because Flay selects MoonPay before opening a Privy modal.
4. Both paths target the authenticated embedded Solana wallet and USDC; the quote path retains Solana mainnet CAIP-2 destination validation.
5. Region lookup is bounded, cached, contains no secret, stores no IP, and fails safely to the non-Stripe path without making checkout slow.
6. MoonPay exit never appears as `submitted` or `confirmed`; Flay tells the user to check the provider result and refresh the authoritative Solana balance.
7. Focused routing tests, full tests, TypeScript, production build, release audit, dependency audit, desktop/mobile browser audit, source scan, and local health pass.
8. `PRIVY_REGION_ROUTING_CORRECTION_AUDIT.md` compares all eight criteria with actual code and includes the founder's next authenticated live result before this correction is called fully complete.

## Completion rule

Complete and verify every autonomous item before requesting a founder retest. Do not declare this correction fully complete until an authenticated production click from the reproduced region opens the MoonPay path rather than the Stripe-unavailable screen. Provider KYC and purchase eligibility remain controlled by MoonPay and must not be represented as successful merely because its flow opens.

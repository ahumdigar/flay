# Flay Privy regional provider routing correction audit

**Date:** 2026-09-24  
**Result:** complete; implementation, deterministic verification, and authenticated founder acceptance pass

## Plan-versus-code comparison

| Criterion | Result | Evidence |
| --- | --- | --- |
| 1. Route Bangladesh, Singapore, UAE, and unknown results to MoonPay; route eligible US/EU/Serbia results to Privy quotes; exclude New York. | Pass | `selectPrivyOnrampRoute` implements the explicit regional boundary. Focused tests cover BD, SG, AE, unknown, Germany, Serbia, California, New York, and sandbox. The live local browser lookup resolves BD to `moonpay`. |
| 2. Keep one automatic action and no Flay provider selector. | Pass | The isolated checkout retains one `Continue to provider` action. Source and desktop/mobile browser audits confirm the old manual provider labels are absent. |
| 3. Prevent the reproduced Bangladesh route from opening the Stripe-only error path. | Pass | `PrivyRoot` awaits the prefetched route and calls the MoonPay funding path before `useFiatOnramp` when the route is `moonpay`. Both local browser audits resolved the reproduced network to `moonpay`. After MoonPay was enabled for the Privy app, the founder completed the authenticated Add Funds launch and confirmed that the flow works. |
| 4. Bind both paths to the authenticated embedded Solana wallet and USDC. | Pass | `PrivyRoot` rejects a missing authenticated embedded wallet. The quote request fixes native USDC, the mainnet Solana CAIP-2 chain, and wallet address. The MoonPay request fixes `solana:mainnet`, `USDC`, the same address, and card funding. Focused tests cover both builders. |
| 5. Bound and cache region lookup without storing an IP or delaying checkout. | Pass | The checkout prefetch starts when the isolated page mounts. Lookup has a 1.2-second abort, a 4 KiB response limit, two-letter country validation, bounded region text, and a safe MoonPay fallback. Session storage receives only `moonpay` or `privy-quotes`; focused tests verify that the returned IP is not stored. |
| 6. Never fabricate a MoonPay submitted/confirmed status. | Pass | The legacy funding exit returns `provider-exited`. Checkout and Funds copy says the provider flow closed, states that Flay has no authoritative purchase status, and refreshes the Solana balance. Request-bound result validation explicitly recognizes this separate status. |
| 7. Pass complete verification. | Pass | Focused and full tests, TypeScript, production build, release audit, dependency threshold audit, targeted and full browser audits, source scan, and health check pass. |
| 8. Compare all criteria and record the founder's next authenticated result. | Pass | This audit maps every criterion. On 2026-09-24, after enabling MoonPay for the Privy app, the founder retried the authenticated Add Funds flow and confirmed that it works. |

## Verification evidence

- Failure evidence: `/storage/emulated/0/hackthon/jjhgb.jpg` shows the production Stripe-only unavailable screen.
- `npm test -- src/privy-fiat-onramp.test.ts`: 1 file and 10 tests passed.
- `npx tsc --noEmit`: passed.
- `npm test`: 41 files passed, 4 skipped; 228 tests passed, 8 skipped.
- `npm run build`: passed; 7,703 modules transformed.
- `npm run release:audit`: passed; 246 bundle files scanned.
- `npm audit --audit-level=high`: passed at the requested threshold; three existing low-severity findings remain in MagicBlock's transitive `elliptic` dependency, whose suggested fix is breaking and unrelated.
- `npm run browser:audit:onramp`: desktop and mobile passed with `regionalRoute: moonpay`, one automatic action, no manual provider choice, correct destination/environment, no overflow, and no runtime exception.
- `npm run browser:audit`: the full app regression passed and independently recorded `regionalRoute: moonpay` for desktop and mobile.
- Relevant shipped-source scan found no TODO, FIXME, placeholder, preview-only behavior, mock fiat behavior, IP logging, or local-storage persistence.
- Local health returns `status: ok`, Privy ready, and production Solana USDC onramp metadata.

## Founder acceptance

On 2026-09-24, the founder enabled MoonPay for the Privy app, refreshed Flay, retried the authenticated Add Funds flow, and confirmed that it works. This proves the intended provider launch and regional-routing correction. Individual purchases remain subject to MoonPay's KYC, regional eligibility, quote, and payment decisions.

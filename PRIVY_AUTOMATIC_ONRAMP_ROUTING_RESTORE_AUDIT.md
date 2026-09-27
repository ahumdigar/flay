# Flay Privy automatic onramp routing restoration audit

**Date:** 2026-09-24  
**Result:** invalidated by live founder acceptance on 2026-09-24

The deterministic checks below passed, but `/storage/emulated/0/hackthon/jjhgb.jpg` proved that the production Privy modal still selected Stripe alone and stopped at `Stripe onramp is not available for USD in this region`. Therefore this audit is historical evidence only and must not be used as a completion claim. Corrective work continues under `PRIVY_REGION_ROUTING_CORRECTION_PLAN.md`.

## Plan-versus-code comparison

| Criterion | Result | Repository evidence |
| --- | --- | --- |
| 1. Restore the recorded working Privy React 3.42.0 release. | Pass | `apps/web/package.json` and `apps/web/package-lock.json` both pin exactly `3.42.0`; the installed package reports `3.42.0`. This matches the version recorded in `PRIVY_FIAT_ONRAMP_COMPLETION_AUDIT.md` when live routing reached Stripe's regional response and MoonPay's KYC flow. |
| 2. Use one automatic `useFiatOnramp().fund(...)` call with no manual provider override. | Pass | `apps/web/src/PrivyRoot.tsx` imports `useFiatOnramp`, obtains `fund`, and calls it once with the validated onramp options. `useFundWallet`, `preferredProvider`, provider parameters, Stripe retry detection, and MoonPay override helpers are absent from the shipped source. |
| 3. Present one provider launch action and explain automatic availability. | Pass | `apps/web/src/fiat/PrivyOnrampCheckoutPage.tsx` has one `Continue to provider` action. `apps/web/src/fiat/FundsPage.tsx` says Privy selects an available provider for the region. Targeted and full browser audits prove the automatic action is visible, manual provider actions are absent, and desktop/mobile have no horizontal overflow. |
| 4. Keep the authenticated Solana mainnet native-USDC destination. | Pass | `apps/web/src/privy-fiat-onramp.ts` binds the authenticated wallet address, native USDC mint, Solana mainnet CAIP-2 chain, environment, fiat allowlist, and bounded amount. The focused destination test passes and browser audits display `Native USDC · Solana` in production mode. |
| 5. Keep payment, KYC, eligibility, quotes, and private payment data inside Privy. | Pass | Flay sends only fiat, amount, destination mint/chain/address, and environment to Privy. The UI states the provider controls eligibility, verification, pricing, and delivery. Source and bundle release scans find no provider secret, payment field, KYC collection, manual provider URL, or provider-specific checkout code. |
| 6. Pass regression and runtime verification without changing other product boundaries. | Pass | Focused tests, all active tests, explicit TypeScript checking, production build, release audit, dependency audit, targeted onramp browser audit, full application browser audit, and local health all pass. Convert, Futures, Stocks, Funds, Activity, gasless send, wallet export, and MagicBlock regression surfaces remain healthy. |

## Verification evidence

- `npm test -- src/privy-fiat-onramp.test.ts`: 1 file and 6 tests passed.
- `npx tsc --noEmit`: passed.
- `npm test`: 41 files passed, 4 skipped; 224 tests passed, 8 skipped.
- `npm run build`: passed with Vite 7.3.6 and Privy React 3.42.0.
- `npm run release:audit`: passed; 246 production bundle files scanned.
- `npm audit --audit-level=high`: passed at the requested threshold. It reports three existing low-severity `elliptic` findings through MagicBlock; the available automatic fix is breaking and unrelated to this restoration.
- `npm run browser:audit:onramp`: desktop and 390px mobile passed production mode, native-USDC destination, automatic action, absence of manual provider controls, checkout isolation, overflow, and runtime-exception checks.
- `npm run browser:audit`: passed the complete desktop/mobile application regression, including Funds and isolated checkout.
- `GET http://127.0.0.1:5173/api/health`: returned `status: ok`, Privy ready, production fiat environment, and native Solana USDC metadata.
- Shipped-source scan for `TODO`, `FIXME`, placeholders, preview-only behavior, `useFundWallet`, `preferredProvider`, and the removed manual provider labels returned no matches.
- Persistent local server: tmux session `flay-dev` is running at `http://127.0.0.1:5173`.

## Live boundary

Privy and its payment providers decide current availability from the user's real region, identity, payment method, and provider service state. Automated tests cannot impersonate the founder, complete KYC, request an SMS, or promise that Stripe or MoonPay will serve a particular session. The repository now exactly restores Flay's previously verified SDK version and single automatic routing path; the next authenticated click will show Privy's current regional result.

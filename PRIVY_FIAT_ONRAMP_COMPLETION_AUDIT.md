# Privy fiat onramp completion audit

**Audit date:** 2026-09-23  
**Plan:** `HACKATHON_PRIVY_FIAT_ONRAMP_PLAN.md` with `PRIVY_ONRAMP_ISOLATED_CHECKOUT_PLAN.md` reliability addendum  
**Status:** parent plan 14 of 15; isolated-checkout addendum implemented and deterministically verified; live purchase result pending  
**Completion claim:** withheld

## Plan-to-code comparison

| Plan block | Actual implementation | Evidence |
| --- | --- | --- |
| Privy bridge | `useFiatOnramp` is initialized under `PrivyProvider`; the bridge fixes the authenticated embedded wallet, Solana mainnet CAIP-2 chain, and native USDC mint. | `apps/web/src/PrivyRoot.tsx`, `apps/web/src/auth.ts`, `apps/web/src/privy-fiat-onramp.ts` |
| Funds interface | Funds validates fiat and amount, opens a dedicated checkout tab, validates request-bound provider results, refreshes balance on result/focus, shows production risk and provider/custody boundaries, and preserves gasless USDC send. | `apps/web/src/fiat/FundsPage.tsx`, `apps/web/src/fiat/PrivyOnrampCheckoutPage.tsx`, `apps/web/src/styles.css` |
| Health and configuration | Health names Privy Card Onramps as active, publishes the active production metadata, and retains Alchemy Pay only as dormant fallback metadata. Sandbox remains the default; production is exact opt-in. | `apps/web/server/api.ts`, `apps/web/server/config.ts`, `apps/web/.env.example` |
| Documentation | Setup covers Dashboard activation, direct Funding URL, support escalation, sandbox values, production opt-in, provider-dependent coverage, Meld KYB, and the dormant Alchemy checkpoint. | `apps/web/README.md`, `ALCHEMY_PAY_WAITING_STATUS.md` |
| SDK dependency | Privy React 3.42.0 and the required Stripe embedded-onramp package are installed. | `apps/web/package.json`, `apps/web/package-lock.json` |
| Verification | Focused tests, full tests, production build, release audit, dependency audit, health probe, and desktop/mobile browser audit pass. | Commands and results below |

## Acceptance criteria

1. **Verified in code.** Funds opens the isolated checkout route, whose deliberate provider action calls `FlayAuth.fundUsdcWithFiat`; the method remains implemented only inside `PrivyBridge` through Privy's `useFiatOnramp().fund`.
2. **Verified.** `buildPrivyOnrampOptions` fixes the authenticated wallet, mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, and chain `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`; unit tests assert the exact object.
3. **Verified.** The checkout URL contains only validated fiat, normalized amount, and a one-time request ID. Wallet, mint, chain, environment, and provider result remain outside page-controlled destination input.
4. **Verified.** Missing, misspelled, or differently cased environment values resolve to `sandbox`; only exact `production` opts in.
5. **Verified.** Fiat is limited to USD, EUR, AUD, and BRL. Amount is a plain decimal from 1.00 through 1,000.00 with at most two decimals.
6. **Verified.** The UI names Privy and possible providers while stating that the final provider, methods, quote, fees, and region are determined in checkout.
7. **Verified.** Flay exposes no card, bank, or identity form and stores no provider payment/KYC payload.
8. **Verified in deterministic paths.** Submitted and confirmed return values have distinct copy. Cancellation, unsupported region, provider failure, and missing configuration are normalized to retryable messages and covered by unit tests.
9. **Verified.** Both Privy success statuses return through a request- and wallet-bound same-origin channel and call the authoritative Solana balance refresh. Returning focus also refreshes without asserting success. The UI does not fabricate an order ID, signature, or settlement record.
10. **Verified.** Search of the active Funds and Privy bridge source finds no Alchemy checkout or order request. Active Alchemy copy is absent from the shipped flow.
11. **Verified for Flay-owned UI.** Desktop and 390px mobile Funds and isolated-checkout audits pass with no horizontal overflow or runtime exceptions. Provider modal ownership is confined to the checkout tab, so the original trading tab remains available. The provider modal itself remains part of the live founder check.
12. **Verified.** Health reports Privy Card Onramps and the active production environment. README and `.env.example` document Dashboard activation, sandbox, production opt-in, provider limits, and Meld KYB for BDT/broader coverage.
13. **Verified.** No private key, verification key, payment data, identity document, or provider credential was added. Release source/bundle scan passes.
14. **Verified.** All deterministic checks listed below pass.
15. **Production routing is verified; completion callback remains pending.** The first Card onramps activation was made on a different Privy app. On 2026-09-22, Card onramps were enabled on the app Flay actually uses (`cmu0x0uyc02pk0cjpvoqm8vg5`) and the local runtime was verified in production mode. The founder then reached real provider routing: Stripe returned its regional restriction and MoonPay opened its KYC purchase flow. No purchase was submitted, so a Privy `submitted` or `confirmed` result is still required before this block can be declared complete.

## Verification evidence

- `npm test -- src/privy-fiat-onramp.test.ts server/api.test.ts`: 2 files, 12 tests passed.
- `npm test`: 38 files passed, 3 skipped; 179 tests passed, 7 skipped.
- `npm run build`: TypeScript and Vite production build passed; Privy onramp and Stripe chunks were emitted.
- `npm run release:audit`: passed; 246 browser bundle files scanned.
- `npm audit --omit=dev`: 0 vulnerabilities.
- `npm run browser:audit`: desktop and mobile Funds plus isolated-checkout checks passed; no runtime exceptions or horizontal overflow. Separate desktop/mobile checkout screenshots were emitted.
- Earlier sandbox health check: `GET http://127.0.0.1:5173/api/health` returned HTTP 200 with Privy Card Onramps, sandbox, USDC, and SOL.
- Production activation check on 2026-09-22: `VITE_PRIVY_ONRAMP_ENV=production` is set in the local runtime environment, the server was restarted, `/api/health` reports `environment: production`, and the focused 10-test onramp/API suite passes.
- Active-path source scan: no TODO, FIXME, placeholder implementation, mock fiat result, fake fiat result, Alchemy checkout call, or Alchemy order call in the Funds/Privy bridge.

## Isolated-checkout addendum comparison

1. **Verified.** A valid action synchronously opens `_blank`; popup blocking produces a recoverable error.
2. **Verified.** URL creation and parsing reject invalid fiat, amount, or request ID.
3. **Verified.** Unit tests prove wallet data is absent from the URL; mint, chain, wallet, and environment remain bridge-controlled.
4. **Verified.** The isolated page waits for authenticated wallet readiness and requires a deliberate button click before `fund`.
5. **Verified by architecture and browser audit.** Privy's modal mounts only in a separate browsing context; closing that tab cannot remove or cover the original Flay UI.
6. **Verified.** Funds accepts only `submitted`/`confirmed` messages matching the current request ID and wallet.
7. **Verified.** A return-focus listener refreshes Solana balance without changing purchase status.
8. **Verified.** Popup failure, provider rejection/cancellation, retry, and manual checkout-tab closure have recovery paths.
9. **Verified.** Focused/full tests, typecheck/build, release/dependency audits, and desktop/mobile browser audits pass.
10. **Verified in this audit.** The Stripe SMS stall and recovery implementation are recorded while parent criterion 15 remains open.

## Remaining live evidence

The 2026-09-22 founder screenshot at `/storage/emulated/0/hackthon/hygvv.jpg` proves that Flay successfully invoked Privy's onramp modal and passed USD 50. After the correct Privy app was enabled and production activated, real provider routing became visible. On 2026-09-23, the founder reached Stripe through a VPN, but its real SMS code never arrived; resending left the full-screen provider modal pending and blocked navigation in that tab. MoonPay reached KYC but officially excludes Bangladeshi residents. The isolated checkout now contains any future provider stall in a disposable tab. A founder retest must confirm that closing the checkout tab leaves the original Spot/Convert view interactive.

1. Use the purchaser's real country of residence and matching KYC details; do not use a VPN to bypass provider restrictions.
2. Review the provider, payment method, fees, and delivered USDC before authorizing a real payment in a supported jurisdiction.
3. If proceeding with a real purchase, record whether Privy returns `submitted` or `confirmed` and verify that Flay shows the matching status and refreshes the Solana USDC balance.

Until a provider returns a final `submitted` or `confirmed` result and the isolated-tab recovery is confirmed in the signed-in mobile flow, criterion 15 remains open and no 100% completion claim is permitted.

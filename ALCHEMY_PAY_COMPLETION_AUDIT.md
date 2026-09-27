# Alchemy Pay implementation completion audit

Audit date: 2026-09-22

Plan reviewed: `HACKATHON_ALCHEMY_PAY_PLAN.md`

Result: incomplete. All implementation and deterministic verification available without merchant access have passed. Acceptance criteria 14 and 16 still require Alchemy Pay merchant credentials, a public HTTPS callback, provider acceptance, and a real founder-controlled payment. The local server currently reports `alchemyPay.configured=false` because no `ALCHEMY_PAY_*` values are present in its `.env`.

## Block status

| Block | Result | Evidence |
| --- | --- | --- |
| A. Server core | Pass | `apps/web/server/alchemy-pay-service.ts`, `config.ts`, `schemas.ts`, `api.ts`, and the focused service/API tests |
| B. Callback and reconciliation | Pass for code and deterministic proof | Signed webhook validation, durable recovery, idempotency, mismatch rejection, and positive-USDC RPC receipt tests pass. A real provider webhook remains part of criterion 14. |
| C. Interface | Pass | `src/fiat/FundsPage.tsx`, App navigation/wallet entry points, responsive styles, server-render test, and desktop/mobile browser audit |
| D. Release proof | Partial | Build, full test suite, browser audit, dependency audit, release scan, and local health pass. Sandbox and production payment evidence remain open. |

## Acceptance criteria mapping

1. **Pass — authenticated wallet ownership.** `requireIdentity` and `assertIdentityWallet` guard checkout/list/detail/refresh routes in `apps/web/server/api.ts`. `alchemy-pay-api-auth.test.ts` proves another Solana address is rejected, and the store hashes the Privy user ID.
2. **Pass — immutable USDC/Solana destination.** `AlchemyPayService.createCheckout` selects `crypto=USDC`, `network=SOL`, and the verified wallet server-side. Client-supplied asset, network, and address fields are ignored and the API test proves the generated checkout remains fixed.
3. **Pass — documented HMAC construction.** `canonicalQuery`, `alchemyPaySignature`, and `signRampParameters` implement the 13-digit timestamp plus `GET` plus `/index/rampPageBuy` and sorted non-empty parameters. Tests cover a fixed vector and recompute the signature from every final URL parameter.
4. **Pass — secret isolation.** Only server configuration reads `ALCHEMY_PAY_APP_SECRET`. Capability and checkout tests prove it is absent from responses. `scripts/release-audit.mjs` scans production bundles for the configuration name and real non-public `.env` values.
5. **Pass — unique persisted merchant orders.** IDs combine time and cryptographic randomness, stay below 48 characters, and are saved atomically before the checkout response. Restart and API persistence tests pass.
6. **Pass — exact amount validation.** Zod and integer-cent parsing reject exponent notation, negatives, excess precision, unsupported fiat, and configured range violations. Unit tests cover each class.
7. **Pass — fixed hosts and expiry.** Test and production hosts are selected only by server configuration. The server stores a 24-hour expiry and list operations expire old created/pending records.
8. **Pass — webhook rejection policy.** Constant-time HMAC verification enforces a five-minute timestamp window. Tests reject stale signatures, altered signatures, wrong app IDs, unknown orders, missing final transaction hashes, and signed wallet mismatches without changing the order.
9. **Pass — idempotent and monotonic state.** Serialized store updates and ranked states prevent regression. Tests repeat callbacks and prove a later pending callback cannot regress a confirmed receipt.
10. **Pass — provider success is separate from receipt.** `FINISHED` first becomes `provider-finished`; `reconcile` checks the reported Solana transaction and requires a positive canonical-USDC balance delta for the reviewed wallet. The state-machine test proves it remains unconfirmed without that delta and confirms after it.
11. **Pass — restart durability.** The bounded 90-day/5,000-order JSON store writes a mode-0600 temporary file and atomically renames it. Restart restoration and corrupt-store fail-closed tests pass. Deployment still must mount the configured path persistently.
12. **Pass — hosted checkout safety.** The UI collects only fiat amount/currency, opens the provider with `noopener noreferrer`, displays test mode, and explicitly states that Flay does not receive payment or KYC data. The browser audit confirms no native payment fields.
13. **Pass — responsive and recoverable UI states.** Status copy/actions cover created, pending, failed, provider-finished, confirmed, expired, and review-required orders. Desktop and 390-pixel browser audits pass without horizontal document overflow and verify status refresh, checkout reopening, wallet copy/balance controls in shipped code.
14. **Open — real sandbox acceptance.** No Alchemy Pay test `appId`/`appSecret` or public HTTPS callback is configured, so an Alchemy-accepted checkout for the actual embedded wallet and a real callback cannot be recorded.
15. **Pass — signed callback behavior.** Deterministic HMAC tests prove valid callbacks update only the matching order and invalid callbacks change nothing. Real provider delivery evidence is still tracked under criterion 14.
16. **Open — production proof.** Production merchant activation, a small founder-controlled payment, provider order ID, transaction signature, verified USDC receipt, and resulting wallet balance are not available.
17. **Pass — automated release checks.** See the command evidence below.
18. **Pass — setup and operations documentation.** `apps/web/README.md` and `.env.example` cover merchant onboarding, server-only secrets, public HTTPS, outbound-IP allowlisting, durable single-writer storage, rotation, test/production hosts, and callback behavior.

## Command evidence

- `npm run build`: passed; 7,696 modules transformed and the production bundle emitted. Rollup reported advisory third-party annotation and chunk-size warnings only.
- `npm test`: 31 files and 146 tests passed; 3 live-provider files containing 7 credential/funding-gated tests were skipped by their explicit environment gates.
- `npx vitest run server/alchemy-pay-service.test.ts server/alchemy-pay-api-auth.test.ts server/api.test.ts src/App.test.tsx`: 4 files and 18 tests passed.
- `npm run browser:audit`: passed at 1440×1000 and 390×844 with no runtime exceptions; emitted `funds-desktop.png` and `funds-mobile.png` alongside Futures regression captures.
- `npm run release:audit`: passed; 246 production bundle files checked.
- `npm audit --omit=dev`: 0 vulnerabilities.
- `GET /api/health`: HTTP 200 with overall `status=ok`; Alchemy Pay safely reports `configured=false`, `environment=test`, `asset=USDC`, and `network=SOL`.

## Evidence still required

1. Add test merchant credentials and the deployed HTTPS origin through the server secret manager; do not put the app secret in chat or a `VITE_` variable.
2. Register the callback and any outbound IP requirement with Alchemy Pay.
3. Generate a sandbox checkout for the signed-in embedded wallet, record provider acceptance and a real signed webhook, and verify the stored order survives a restart.
4. After production activation, run one smallest permitted founder-controlled order and record the provider order ID, Solana transaction, positive USDC receipt, and updated balance.

The completion rule prevents a release-completion claim until those two open criteria have evidence.

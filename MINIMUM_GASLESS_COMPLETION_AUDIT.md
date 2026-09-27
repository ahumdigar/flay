# Flay minimum gasless plan-versus-code audit

Status: incomplete — 13 of 14 acceptance criteria pass. Criterion 12 requires a founder-approved live mainnet swap and remains open.

Audit date: 2026-09-22

Binding plan: `HACKATHON_MINIMUM_GASLESS_PLAN.md`

## Scope verified

The shipped implementation is limited to provider-sponsored Jupiter Convert market swaps. It does not add an integrator payer, sponsor wallet, Kora, referral fee, custom Solana program, or gasless behavior to Raydium, Orca, Jupiter Trigger limits, Futures, MagicBlock, fiat, or transfers. Jupiter eligibility remains dynamic and is decided on each prepared order.

## Acceptance criteria

| # | Result | Code and evidence |
|---|---|---|
| 1 | PASS | `src/App.tsx` says eligibility is checked on the exact Jupiter review and labels non-Jupiter routes as wallet-paid. `apps/web/README.md` lists the exact included and excluded scope. |
| 2 | PASS | `server/providers/jupiter.ts` recognizes sponsorship only when `gasless === true` and `signatureFeePayer` is a valid key distinct from the taker. `server/providers/jupiter.test.ts` covers sponsored, user-paid, and malformed responses. |
| 3 | PASS | `server/quote-service.ts` records the prepared payer in `TransactionExpectations`; `server/transaction-validation.ts` requires the actual first signer/fee payer to match. Mismatch tests pass. |
| 4 | PASS | `validateTransactionSigners` requires the authenticated wallet among required signers and, for sponsored orders, rejects every external signer except the exact recorded Jupiter payer. The official JupiterZ Order Engine program is allowed only when the prepared router is JupiterZ. |
| 5 | PASS | `JupiterAdapter.prepare` records only the declared signature payer as an allowed external signer. `QuoteService.execute` uses partial-signature simulation only when the stored provider is Jupiter and the stored gas mode is provider-sponsored. |
| 6 | PASS | `assertMessageUnchanged` performs a timing-safe byte comparison and `assertWalletSignature` verifies the taker's Ed25519 signature over the serialized message before `/execute`. Altered-message, altered-signature, and missing-signature tests pass. |
| 7 | PASS | Contradictory and malformed sponsorship fails with `JUPITER_GASLESS_INVALID`; expired records fail in `EphemeralStore`; altered messages fail before execution; UI sponsorship depends only on verified stored metadata. |
| 8 | PASS | `ReviewModal` and the success receipt show `Sponsored by Jupiter`, the verified payer, and that quoted output reflects Jupiter's possible sponsorship recovery. User-paid review shows the SOL estimate and wallet payer. SSR disclosure tests pass. |
| 9 | PASS | Non-sponsored Jupiter orders get `mode: user-paid`; other market adapters receive a server-created user-paid record. Limit, Futures, MagicBlock, fiat, and transfer code paths were not changed to claim sponsorship. |
| 10 | PASS | No sponsor key, payer configuration, Kora package/service, referral parameter, or custom program was added. Jupiter is called without an integrator `payer`. |
| 11 | PASS | Deterministic tests cover sponsored and user-paid classification, malformed fields, payer mismatch, unknown signers, exact-message tampering, valid/missing/altered wallet signatures, retained idempotent execution results, provider read retry, and both review disclosures. |
| 12 | OPEN | No founder-approved live eligible swap has been signed or submitted during this audit. `MINIMUM_GASLESS_LIVE_ACCEPTANCE.md` contains the exact evidence record. |
| 13 | PASS | Type check and production build pass; all deterministic tests pass; responsive browser audit passes; release source/bundle scan passes; `npm audit --omit=dev` reports zero vulnerabilities; opt-in live quote-provider test passes. |
| 14 | PASS | `apps/web/README.md` documents architecture, dynamic eligibility, fees, exclusions, fallback behavior, lack of extra configuration, and safe evidence collection. The live record excludes secrets and signed transaction bytes. |

## Verification evidence

- `npm run check`: production TypeScript/Vite build passed; 32 test files and 157 tests passed, with 3 opt-in suites and 7 tests skipped.
- `npm test`: deterministic suite passed after the final UI disclosure test was added.
- `LIVE_PROVIDER_TESTS=1 npm test -- server/live-providers.test.ts`: 1 live read-only mainnet provider test passed.
- Live read-only gasless preparation: Flay's actual Jupiter adapter built a `0.19 USDC → SOL` JupiterZ order with `provider-sponsored` mode; recorded and transaction fee payers matched, the user wallet remained a required signer, the official RFQ settlement program passed the route-scoped allowlist, and exact balance-delta simulation passed. Nothing was signed or submitted.
- `npm run browser:audit`: desktop 1440×1000 and mobile 390×844 passed without horizontal page overflow or runtime exceptions; Convert gasless scope disclosure was present.
- `npm run release:audit`: source and 246 production bundle files passed unfinished/mock/secret scanning.
- `npm audit --omit=dev`: 0 vulnerabilities.
- Local health: `status=ok`, `gasless.scope=eligible-jupiter-market-swaps`, `provider=Jupiter`, `integratorSponsor=false`.

## Plan comparison

Blocks A, B, and C are implemented. Block D's deterministic, live read-only, build, browser, dependency, and release checks pass. The founder-signed portion of Block D is still open. The shared `gasPayment` field is optional at the TypeScript boundary so older limit-order responses remain compatible; every prepared market swap now returns either verified provider-sponsored or explicit user-paid metadata.

No plan item was removed or weakened. The broader platform gasless plan remains preserved and paused.

## Completion gate

Do not change this audit to passing and do not describe the minimum gasless block as complete until criterion 12 contains a confirmed transaction whose non-user fee payer matches the payer recorded at review.

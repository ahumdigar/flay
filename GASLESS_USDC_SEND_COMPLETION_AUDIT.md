# Flay gasless USDC send plan-versus-code audit

Status: incomplete — 16 of 17 acceptance criteria pass. Criterion 17 requires one founder-approved mainnet send and remains open.

Audit date: 2026-09-22

Binding plan: `HACKATHON_GASLESS_USDC_SEND_PLAN.md`

## Scope verified

The shipped path is limited to mainnet legacy USDC from the authenticated Privy embedded wallet to a different on-curve wallet whose canonical USDC account already exists. It uses Privy's managed payer and adds no Flay sponsor wallet, sponsor key, relayer, Kora node, delegated wallet access, custom program, ATA creation/closure, SOL send, arbitrary token send, Futures sponsorship, MagicBlock sponsorship, Trigger sponsorship, off-ramp, or fiat withdrawal.

## Acceptance criteria

| # | Result | Code and evidence |
|---|---|---|
| 1 | PASS | `server/api.ts` protects prepare and status with `requireIdentity`, and `assertIdentityWallet` binds the submitted wallet to the embedded Solana wallet in the verified identity token. `server/gasless-usdc-send-api-auth.test.ts` proves another wallet is rejected before RPC work. |
| 2 | PASS | `server/gasless-usdc-send-service.ts` fixes `USDC_MINT`, six decimals, and `TOKEN_PROGRAM_ID`; neither API schema nor client request accepts a mint/program/decimals field. |
| 3 | PASS | `gaslessUsdcSendPrepareSchema`, `decimalToAtomic`, the form, and the service reject invalid/noncanonical/self/off-curve recipient, zero, negative, decimal atomic units, exponent notation, over-u64 values, excess UI precision, and insufficient confirmed USDC. Schema and service tests cover these cases. |
| 4 | PASS | The service derives the canonical recipient ATA, requires it to exist, requires legacy SPL Token ownership, and uses `unpackAccount` to verify the exact USDC mint and reviewed recipient owner. Missing/invalid accounts fail closed. |
| 5 | PASS | `validateGaslessUsdcSendTransaction` requires one signer before sponsorship and decodes exactly one `TransferChecked` instruction with the source ATA, mint, destination ATA, authority, amount, and decimals from review. Tests decode the returned transaction and reject altered amounts. |
| 6 | PASS | The validator rejects lookup tables, extra instructions, extra signers, non-token programs, and multisig. The builder includes no create, close, SOL transfer, memo, arbitrary call, or hidden fee. Extra-SystemProgram tests fail as required. |
| 7 | PASS | The server runs confirmed RPC simulation with `sigVerify:false` only before user/Privy signatures exist. A program simulation error returns `SEND_SIMULATION_FAILED`; its deterministic test passes. Live read-only mainnet preparation and simulation also pass. |
| 8 | PASS | `src/PrivyRoot.tsx` sends only server bytes through `useSignAndSendTransaction`; `src/privy-sponsored-send.ts` fixes mainnet, `sponsor:true`, visible approval, simulation enabled, and non-optimistic broadcast. Unit tests pin every option and the required 64-byte signature. |
| 9 | PASS | There is no non-sponsored branch. Privy failure propagates to an actionable UI error, and no RPC wallet-paid submission exists in this flow. Review explicitly says no wallet-paid fallback. |
| 10 | PASS | `GaslessUsdcReview` shows exact amount, full recipient, USDC/Solana, `Sponsored by Privy`, 0% Flay fee, and existing-account restriction. SSR tests verify the disclosure. |
| 11 | PASS | Submission is initially stored as pending. `GaslessUsdcSendService.status` returns confirmed only after exact onchain instruction, token deltas, external fee payer, and zero sender lamport delta pass. The UI includes retry and Explorer controls. Receipt tests cover the confirmed and wallet-paid rejection paths. |
| 12 | PASS | Server/API/UI branches cover pending, confirmed, failed, user rejection, disabled/exhausted sponsorship guidance, expired review, RPC failure, simulation failure, and malformed Privy signature. `ErrorBoundary`, modal focus/escape handling, and browser runtime-exception checks protect against a blank screen. |
| 13 | PASS | `parseStoredGaslessSends` validates, sanitizes, and limits history to five rows containing only public signature, wallet, recipient, atomic amount, time, and status. Tests prove extra serialized-transaction data is discarded. |
| 14 | PASS | `scripts/browser-audit.mjs` verifies the Funds send card, safety boundary, and the prominent `Send USDC · Gasless` shortcut at 1440×1000 and 390×844. The shortcut is above the fold and targets the send form in both layouts. Both layouts pass without page overflow or runtime exceptions; screenshots are in `apps/web/artifacts/browser/`. |
| 15 | PASS | `apps/web/README.md` documents TEE execution, Privy billing/credits, sponsor toggle, Solana mainnet, client sponsorship, spend caps, monitoring, no secrets, existing-recipient-ATA restriction, recovery, and live acceptance. |
| 16 | PASS | TypeScript/Vite production build passes; 37 deterministic test files and 169 tests pass; 3 opt-in suites/7 tests remain intentionally skipped; browser, release, and dependency audits pass. |
| 17 | OPEN | `GASLESS_USDC_SEND_LIVE_ACCEPTANCE.md` records the passing live read-only preparation. A founder-approved signed transaction, recipient credit, non-user fee payer, and zero sender lamport fee debit are still required. |

## Verification evidence

- `npm test`: 37 files and 169 tests passed; 3 opt-in files and 7 tests skipped.
- `npm run build`: TypeScript checking and the production Vite build passed.
- `npm run browser:audit`: desktop and mobile Funds/Futures/shell checks passed; the above-fold gasless Send shortcut, send card, restrictions, safe fields, no-overflow state, and zero runtime exceptions were verified.
- `npm run release:audit`: source and 246 production bundle files passed the release scan.
- `npm audit --omit=dev`: zero vulnerabilities.
- Local `/api/health`: `status=ok`, Privy and RPC ready, `scope=eligible-jupiter-market-swaps-and-usdc-send`, providers `Jupiter` and `Privy`, `privyManagedSponsor=true`, and no Flay integrator sponsor.
- Unauthenticated live prepare request: rejected with HTTP 401 and `AUTH_REQUIRED`.
- Live read-only mainnet preparation: the actual service built and simulated `1` atomic USDC from the founder wallet to an existing recipient ATA and returned provider-sponsored Privy metadata. No signature or submission occurred.
- `agent.md` tail matches the complete binding plan byte-for-byte.

## Plan comparison

Blocks A, B, and C are implemented. Block D's deterministic, build, security, release, browser, setup, and live read-only checks pass. The founder-signed portion of Block D remains open because only the wallet owner can approve the transfer and only Privy's dashboard can expose the app's billing/sponsorship state.

No acceptance criterion was removed or weakened. The implementation is intentionally stricter than a general wallet transfer: it refuses missing recipient ATAs and every additional instruction to avoid account-rent sponsorship and rent-refund abuse.

## Completion gate

Do not change this audit to passing or describe this block as 100% complete until criterion 17 is populated with a confirmed public transaction and the server verifies exact recipient credit, a non-sender fee payer, and `senderNetworkFeeLamports: "0"`.

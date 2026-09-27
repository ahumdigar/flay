# Flay platform gasless implementation plan

Status: active implementation plan

This plan adds SOL-free transaction execution to every Flay-owned transaction flow. It is a shared platform layer over Convert, Futures, and MagicBlock. The existing Convert and Futures plans remain binding for their product behavior.

## 1. Product promise

A signed-in Flay user can use supported Flay actions without keeping SOL for network fees, priority fees, account rent, or venue-required SOL execution charges that Flay explicitly agrees to sponsor. The review screen must show whether Flay will sponsor the action before the user signs.

Gasless means that the user does not pay SOL. Flay still pays real costs from a bounded sponsor budget. Trading principal, collateral, swap input, price impact, venue fees charged in traded assets, funding, borrowing, and losses remain the user's responsibility.

## 2. Scope

### Included actions

1. Jupiter market swaps, including signature fees, priority fees, and route-created account rent supported by Jupiter's payer contract.
2. Jupiter Trigger order create and cancel when its returned transaction supports a distinct payer.
3. Raydium and Orca market swaps after their transactions can be built with the reviewed Flay sponsor as fee payer without changing trade authority or custody.
4. Phoenix onboarding, open, reduce, close, and cancel actions.
5. GMTrade open, reduce, close, and cancel actions.
6. MagicBlock deposit, private transfer, withdrawal, recovery, and settlement actions that are represented by a user-signed Solana transaction.
7. Associated token account rent when created by an included action and bounded by policy.

### Excluded behavior

1. Arbitrary wallet sends, arbitrary program calls, or arbitrary token-account creation.
2. Fiat purchase fees, trading principal, margin collateral, funding, borrowing, liquidation losses, or venue fees denominated in the traded asset.
3. Deposits sent from an external wallet outside a Flay-built transaction.
4. Unlimited public sponsorship.
5. A custom Flay Solana program. The hackathon build must deploy no custom program.

## 3. Architecture

### 3.1 Sponsor boundary

Flay will use a server-side `GasSponsor` interface. The first production transport is a Kora-compatible JSON-RPC signer. Sponsor credentials and signing material never enter the browser, transaction APIs, logs, or repository.

The sponsor public key is known before a transaction is built. The provider or local builder constructs the exact transaction with that public key as fee payer. The user signs the immutable message through Privy. The server verifies the user's signature and the reviewed intent, obtains the sponsor signature for the same message, then submits it once.

The server must never rewrite the blockhash, fee payer, instructions, lookup tables, or account list after the user's signature.

### 3.2 Gasless lifecycle

1. Authenticate the Privy access token and bind it to the requested wallet.
2. Apply the gasless allowlist, per-user rate limit, daily budget, action cap, and global circuit breaker.
3. Build the exact provider transaction with the configured sponsor fee payer.
4. Decode and validate all programs, accounts, amounts, mints, markets, destinations, and signer roles against the reviewed intent.
5. Estimate the sponsor cost. Reject above the per-action or remaining daily budget.
6. Simulate with signature verification disabled only for the missing signatures. A simulation failure cannot be sponsored.
7. Store a short-lived preparation record keyed by an unguessable ID and exact message hash.
8. Show `Sponsored by Flay`, the estimated sponsored SOL, and the actual user-paid trade costs in the review UI.
9. Receive the user-signed transaction. Verify the immutable message, preparation record, expiry, wallet signature, sponsor payer, and idempotency key.
10. Re-run policy and budget reservation immediately before sponsor signing.
11. Ask the sponsor service to co-sign and submit the exact transaction.
12. Record only non-secret receipt data: user ID hash, action, provider, transaction signature, sponsored lamports, status, and timestamps.
13. Reconcile the confirmed receipt and release or correct the budget reservation.

### 3.3 Cost classes

- `network`: base signature fee and priority fee.
- `rent`: bounded rent for reviewed accounts created by the action.
- `venue-sol`: an explicit, documented SOL charge required by a venue.
- `trade`: input, collateral, and asset-denominated venue costs; never sponsored by this layer.

An action may be marked gasless only when every required SOL cost class is covered. A fee-payer-only transaction must not be presented as gasless if an instruction still debits SOL from the user.

## 4. Provider implementation matrix

| Product path | Strategy | Required proof |
| --- | --- | --- |
| Jupiter market | Pass sponsor as Swap V2 `payer`; require response `gasless=true` and all payer fields equal the configured sponsor | Live small-value swap from a wallet with insufficient SOL |
| Jupiter Trigger create | Pass sponsor as `payer`, keep user as `maker`, validate both roles | Live small-value limit create |
| Jupiter Trigger cancel | Use a provider-supported sponsor payer if available; otherwise rebuild only from documented instructions | Live cancellation with the same zero-SOL wallet |
| Raydium market | Build returned transaction with distinct sponsor payer only if provider contract preserves user trade authority | Live small-value swap and transaction-account audit |
| Orca market | Build Whirlpool transaction with sponsor payer and user owner/authority | Live small-value swap and transaction-account audit |
| Phoenix | Sponsor fee payer; cover only reviewed Phoenix rent or explicit SOL need through a bounded atomic sponsor transfer when unavoidable | First-time onboarding plus open, cancel, reduce, and close from an insufficient-SOL wallet |
| GMTrade | Sponsor fee payer; identify every explicit execution/rent debit and cover it only through a bounded atomic transfer when unavoidable | Open, cancel, reduce, and close from an insufficient-SOL wallet |
| MagicBlock | Use provider-supported payer separation; reject gasless labeling where the builder fixes the user as payer | Deposit, private transfer, withdrawal, and recovery evidence |

If a provider cannot preserve the user's authority while accepting a distinct payer, that route is temporarily ineligible for a gasless action. The router must consider gasless eligibility and must never silently fall back to user-paid SOL.

## 5. Sponsor policy and abuse controls

1. Default gasless mode is `off`. Production modes are `allowlist` and `public`.
2. Hackathon launch uses authenticated-wallet allowlisting and a hard global daily budget.
3. Every provider program, action, input/output mint, market, recipient, and writable account role is allowlisted.
4. System transfers are denied unless they are an internally generated sponsor-to-current-user top-up with an exact computed amount and action-specific cap.
5. Sponsor-to-user top-ups must be atomic with the reviewed venue action and unavailable as a standalone endpoint.
6. Per-user limits cover requests per minute, sponsored actions per day, sponsored lamports per day, and failed simulations.
7. Global controls cover daily lamports, minimum sponsor balance, maximum transaction fee, maximum rent, maximum venue SOL, and an emergency circuit breaker.
8. Preparation records expire after 90 seconds and can execute once.
9. Duplicate requests return the original receipt and never spend twice.
10. Failed policy checks, stale blockhashes, altered messages, missing signatures, unexpected signers, and unexpected writable accounts fail closed.
11. Account-rent sponsorship must account for rent-reclaim abuse. User-closeable accounts are denied or charged to a separate strict lifetime quota.
12. Logs redact authorization headers, provider request bodies, full signed transactions, sponsor responses, and user identity tokens.

## 6. Configuration

Required server-only values:

- `GASLESS_MODE=off|allowlist|public`
- `GAS_SPONSOR_PUBKEY`
- `KORA_RPC_URL`
- `KORA_API_KEY` or Kora HMAC credentials
- `GASLESS_ALLOWED_WALLETS` for hackathon allowlist mode
- `GASLESS_DAILY_BUDGET_LAMPORTS`
- `GASLESS_USER_DAILY_BUDGET_LAMPORTS`
- `GASLESS_MAX_NETWORK_LAMPORTS`
- `GASLESS_MAX_RENT_LAMPORTS`
- `GASLESS_MAX_VENUE_LAMPORTS`
- `GASLESS_MIN_SPONSOR_BALANCE_LAMPORTS`

Startup fails closed for gasless execution when mode is enabled but any required sponsor setting is missing or invalid. Health reports readiness and budget state without exposing credentials or exact private balances.

## 7. User experience

1. Review cards show `Gas: Sponsored by Flay` and an estimated sponsored amount.
2. Asset-denominated venue costs remain separate and visible.
3. Route comparison includes gasless eligibility, so an ineligible route cannot be described as gasless.
4. The signing prompt clearly says that the user authorizes the reviewed trade while Flay pays the SOL costs.
5. Receipts show provider, action, user-paid costs, sponsored SOL, signature, explorer link, and final status.
6. When the sponsor budget is unavailable, the action shows a clear unavailable state. It must not quietly ask the user to pay SOL.
7. A zero-SOL user must be able to distinguish a gasless action before opening Privy.

## 8. Implementation blocks

### Block A: shared sponsor core

- Typed configuration with strict validation.
- Sponsor client with timeout, authentication, redaction, and exact-message signing.
- Policy engine, budget reservation ledger, rate limits, idempotency, and circuit breaker.
- Preparation schema and receipt fields for gasless metadata.
- Shared transaction helpers that find signatures by public key rather than positional index.
- Health/readiness and UI capability contract.
- Unit and adversarial tests.

### Block B: Convert

- Jupiter market first using documented payer support.
- Jupiter Trigger create and cancel.
- Raydium and Orca after separate-payer proofs.
- Review and receipt UI.
- Live zero-SOL small-value acceptance evidence for every enabled route.

### Block C: Futures

- Remove positional fee-payer assumptions while preserving wallet-authority signature checks.
- Phoenix cost accounting, atomic bounded rent/fee sponsorship, and provider compatibility.
- GMTrade network and execution-fee accounting with bounded sponsorship.
- Route selection compares only executable gasless routes when gasless mode is active.
- Open, cancel, reduce, close, recovery, and onboarding acceptance evidence.

### Block D: MagicBlock

- Separate sponsor payer from private-balance authority wherever the provider supports it.
- Cover base-chain deposit, withdrawal, recovery, and settlement SOL requirements.
- Preserve private transaction semantics and avoid exposing private amounts through gasless telemetry.
- Live acceptance evidence for every enabled action.

### Block E: operations and completion audit

- Sponsor funding/runbook, budget alerts, key rotation, pause/resume, and incident recovery.
- Fresh-install configuration documentation.
- Full deterministic, build, browser, security, and live-mainnet test suite.
- `GASLESS_COMPLETION_AUDIT.md` mapping every acceptance criterion to code and evidence.

## 9. Acceptance criteria

1. Every Flay-built state-changing transaction is inventoried and assigned a gasless implementation or is disabled while gasless mode is active.
2. No enabled gasless path requires the user wallet to hold SOL before preparation, signing, simulation, submission, or confirmation.
3. Every enabled transaction uses the configured sponsor as fee payer, while the user remains the required asset or venue authority.
4. Every explicit SOL debit is identified and either sponsored within policy or causes a clear pre-sign rejection.
5. The server verifies the user's Privy identity, wallet binding, exact message, wallet signature, sponsor payer, intent, expiry, and idempotency before sponsor signing.
6. No browser bundle, API response, log, repository file, or error contains sponsor credentials or private signing material.
7. Arbitrary transfer, altered recipient, altered amount, altered program, replay, stale preparation, duplicate submission, rent farming, and budget-exhaustion tests fail safely.
8. Per-user and global budgets are atomic under concurrent requests and survive a server restart.
9. The UI identifies sponsorship before signing and receipts identify the confirmed sponsored amount afterward.
10. Router behavior excludes gasless-ineligible routes and explains when no gasless route is available.
11. Jupiter market and Trigger create/cancel pass live mainnet small-value tests from an insufficient-SOL wallet.
12. Every enabled Raydium and Orca route passes the same live zero-SOL test; routes without proof remain disabled in gasless mode.
13. Phoenix onboarding/open/cancel/reduce/close and GMTrade open/cancel/reduce/close pass live zero-SOL tests, including explicit venue SOL costs.
14. MagicBlock deposit/private-transfer/withdraw/recovery actions pass live zero-SOL tests without leaking private transfer data.
15. Sponsor low balance, Kora timeout, provider timeout, simulation failure, confirmation uncertainty, and restart recovery preserve user funds and produce actionable status.
16. The production build, type check, deterministic tests, browser audit, dependency audit, transaction-security suite, and release audit pass.
17. Setup and operations documentation lets a fresh deployment configure Kora, fund the sponsor, set budgets, rotate credentials, and pause sponsorship without exposing secrets.
18. No custom Flay Solana program is deployed or required.
19. The final completion audit compares every line of this plan with the actual code and records real transaction signatures for all live acceptance flows.

## 10. Completion rule

Gasless cannot be called complete while any state-changing Flay path is user-paid, silently falls back to user-paid SOL, lacks a live insufficient-SOL proof, lacks abuse controls, or is disabled without being explicitly identified as unavailable. A provider integration blocked by credentials, funding, provider behavior, or live signatures remains incomplete even if its interface and tests are implemented.

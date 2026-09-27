# Raydium and Orca gasless Convert completion audit

**Plan:** `HACKATHON_RAYDIUM_ORCA_GASLESS_PLAN.md`  
**Audit date:** 2026-09-23  
**Overall status:** incomplete — deterministic implementation is verified, but acceptance criterion 11 requires two founder-approved mainnet transactions.

## Verification evidence

- `npm run check`: latest production TypeScript/Vite build passed; 195 tests passed and 7 separately gated live tests were skipped. The focused sponsorship run passed 33 tests across transaction validation, store, API, execution boundary, Privy options, and UI files. The exact-affordability addendum has separate evidence in `EXACT_SOL_AFFORDABILITY_FIX_AUDIT.md`.
- `npm run browser:audit`: passed for desktop and mobile with no runtime exceptions, including Convert, Activity, Funds, wallet-dialog recovery, and isolated onramp checkout checks.
- `npm run release:audit`: passed; 246 built bundle files plus shipped source were scanned.
- `npm audit --omit=dev`: passed with 0 vulnerabilities.
- Local `GET /api/health`: the restarted server reports `eligible-market-swaps-and-usdc-send`, Jupiter and Privy sponsorship providers, and ready Raydium/Orca adapters.
- Live read-only route probe: a 0.5 USDC to USDT quote returned Jupiter, Raydium, and a direct Orca Whirlpool with no provider failure. No transaction was signed or submitted.
- Shipped-source search found no TODO/FIXME, fake trading data, illustrative trading state, or preview-only execution marker. Ordinary HTML input placeholders are not implementation placeholders.

## Acceptance criteria

### 1. Sponsorship is labeled only after exact eligibility checks

**Deterministic status: passed.** `apps/web/server/quote-service.ts` first rebuilds and validates the fresh venue transaction, simulates its token and SOL deltas, then calls `assertPrivySponsoredMarketTransactionSafe`. Only a successful result creates a `provider-sponsored` / `Privy` review. An eligibility failure produces a user-paid review with the reason only after the exact simulation proves affordability. `apps/web/server/transaction-validation.test.ts` proves both the eligible existing-account branch and multiple rejection branches.

### 2. Privy is the managed payer and Flay holds no sponsor secret or custom program

**Implementation status: passed; live payer proof pending under criterion 11.** `apps/web/src/PrivyRoot.tsx` calls Privy's React `signAndSendTransaction` with `sponsor: true`. `apps/web/src/privy-sponsored-send.ts` fixes Solana mainnet, keeps simulation enabled, disables optimistic broadcast, and shows explicit wallet approval. No sponsor key, Flay fee-payer wallet, Kora integration, new environment secret, or Flay Solana program was added.

### 3. Unsafe route shapes cannot enter sponsorship

**Deterministic status: passed.** `apps/web/server/transaction-validation.ts` permits only Raydium/Orca market swaps between SPL assets, requires one pre-sponsorship wallet signer and both existing canonical token accounts, and rejects System Program, Associated Token Program, Token `CloseAccount`, Token `SyncNative`, native SOL, unknown signers, and malformed accounts. Raydium already rejects multi-transaction builds; Orca requires a versioned transaction. Tests cover native SOL, system/rent behavior, missing accounts, associated-account creation, and account closure.

### 4. Preparation is bound to wallet, quote, venue, pool, tokens, input, and minimum output

**Deterministic status: passed.** `QuoteService.prepare` rebuilds a fresh provider quote and records `TransactionExpectations`. `validateTransactionStructure` requires the authenticated wallet signer, payer, reviewed mints, canonical wallet accounts, every quoted pool, allowed venue programs, and no unrelated writable wallet token account. `simulateAndVerifyDeltas` requires the exact input debit and minimum output before review.

### 5. Privy simulation stays enabled and there is no silent wallet-paid fallback

**Deterministic status: passed.** `privySponsoredMarketOptions` sets `sponsor: true`, `skipSimulation: false`, and `optimisticBroadcast: false`; its unit test fixes those values. The UI selects this path only for a review already marked `Sponsored by Privy`. It does not call wallet signing or `/transactions/execute` if Privy sponsorship fails. Ineligible transactions become user-paid before review and must pass exact transaction simulation.

### 6. Completion verifies the confirmed onchain transaction

**Deterministic status: passed; live receipt proof pending under criterion 11.** The authenticated `/api/transactions/sponsored/complete` endpoint fetches the confirmed v0 transaction and revalidates venue structure, wallet signature, actual non-user fee payer, successful status, positive fee, exact input debit, minimum output credit, and zero wallet SOL delta. Receipt tests reject a wrong signature, user payer, wallet SOL change, wrong input debit, insufficient output, and onchain error.

### 7. Completion is idempotent and other execution paths fail safely

**Deterministic status: passed.** `EphemeralStore.markSubmitted` retains the signature for confirmation recovery and rejects a different signature. `completePrivySponsored` returns the same stored result for the same signature and rejects conflicts. `QuoteService.execute` always rejects a Privy-sponsored preparation, including after broadcast; a regression test covers both states. The review changes to `Verify sponsored transaction` after broadcast without asking Privy to sign again.

### 8. Review, approval, success, and Activity are truthful

**Deterministic status: passed.** Route cards state that sponsorship is checked at review. Eligible reviews show `Sponsored by Privy` and leave the payer address unclaimed until broadcast. Privy's approval names Raydium or Orca. The success modal shows the actual `ExecutionResult.gasPayment`; new Activity records persist and display `Gas sponsored by Privy`, `Gas sponsored by Jupiter`, or `Network gas paid by wallet`. Existing records remain readable as `Gas payment not recorded`.

### 9. Existing Jupiter and user-paid paths still work

**Regression status: passed.** The complete application suite and production build passed. Jupiter retains its provider execute path and exact provider-payer checks. Direct routes that fail the Privy boundary retain normal wallet signing and RPC broadcast; candidate routes use their exact simulated SOL debit instead of the general fixed reserve. UI tests cover Jupiter-sponsored, Privy-sponsored, and user-paid reviews.

### 10. Deterministic and release checks pass

**Status: passed.** The build, tests, browser audit, release audit, dependency audit, runtime health probe, documentation review, and shipped-source marker search have passed. Setup documentation now explains both managed sponsor paths, the safe Raydium/Orca boundary, dashboard controls, recovery, and live acceptance.

### 11. Low-SOL Raydium and Orca mainnet transactions prove sponsorship

**Status: open.** This requires the founder-controlled Privy wallet and visible approvals. For each venue, record only:

- the public Explorer transaction signature;
- the selected venue and SPL-to-SPL pair;
- the actual fee payer, proving it differs from the embedded wallet;
- the wallet's unchanged SOL balance across the transaction;
- the exact input debit and output credit at or above the reviewed minimum.

USDC to USDT currently exposes both Raydium and direct Orca routes at 0.01, 0.05, 0.1, and 0.5 USDC in read-only probes. The founder wallet's canonical USDC account exists, while its canonical USDT account is currently missing. Create that account first through the already sponsored Jupiter conversion if its exact review confirms Jupiter sponsorship; then refresh and test each direct venue. Route availability is dynamic. No identity token, serialized transaction, private key, or wallet secret belongs in this audit.

## Final post-audit run

Passed on 2026-09-23: the latest production build succeeded and the full suite reported 195 passed tests with 7 explicitly gated live tests skipped. Do not change the overall status to complete until criterion 11 has both confirmed signatures and fee-payer evidence.

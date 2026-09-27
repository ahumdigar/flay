# Exact SOL affordability fix audit

**Plan:** `HACKATHON_EXACT_SOL_AFFORDABILITY_FIX_PLAN.md`  
**Audit date:** 2026-09-23  
**Overall status:** incomplete — implementation, live preparation, and all automated gates pass; founder-authenticated review remains open.

## Verification evidence

- Final `npm run check`: production TypeScript/Vite build passed; 195 tests passed and 7 separately gated live tests were skipped.
- Focused type check and tests passed across quote cost derivation, canonical token binding, simulation error decoding, transaction validation, balance checks, and review UI.
- `npm run browser:audit`: passed on desktop and mobile with no runtime exceptions.
- `npm run release:audit`: passed across shipped source and 246 built bundle files.
- `npm audit --omit=dev`: 0 vulnerabilities.
- An initial read-only Raydium direct build at 0.01 USDC to USDT simulated successfully. Raydium later changed to a two-pool route requiring two rent-bearing accounts; simulation correctly rejected it with 1,398,305 lamports left before a second 1,488,440-lamport rent payment, a 90,135-lamport shortfall.
- Live read-only Orca direct build and full `QuoteService.prepare` for the founder wallet passed at 0.01 USDC to USDT: network fee 10,000 lamports, total wallet debit 1,498,440 lamports, rent/required SOL 1,488,440 lamports, and minimum output 9,948 atomic USDT. The returned review is `user-paid` and warns that account creation is outside sponsorship. No transaction was signed or submitted.
- Jupiter's current 0.01 USDC to USDT build returned `Failed to get quotes`; Orca is the verified setup path at this amount.

## Acceptance criteria

1. **Passed.** Candidate Jupiter/Raydium/Orca SPL routes run only a principal precheck before build. `QuoteService.prepare` no longer re-applies the fixed 0.005 SOL reserve after a user-paid transaction has been built.
2. **Passed.** `simulateAndVerifyDeltas` remains mandatory and returns the exact simulated wallet lamport delta. RPC simulation rejects unaffordable network fees or rent before review.
3. **Passed.** Transaction structure, signer, provider, pool, mint, canonical account, exact input, and minimum-output checks are unchanged. The full regression suite passes.
4. **Passed.** `applySimulatedUserPaidCost` records total wallet debit and separates the known network fee from account rent or other required SOL. `ReviewModal` shows both values; tests cover a 2,049,280-lamport example.
5. **Passed.** The parent Privy eligibility function still requires both canonical token accounts and rejects Associated Token Program, System Program, close-account, sync-native, and other excluded actions. The missing-USDT-account setup remains user-paid.
6. **Passed.** Existing Jupiter/Privy sponsorship branches are returned unchanged by the cost helper. Full Convert, limit, Futures, MagicBlock, fiat, and USDC-send regression tests pass.
7. **Passed.** Type checking, production build, full tests, browser audit, release audit, dependency audit, and live read-only simulation pass.
8. **Open.** Live Orca preparation proves the founder wallet's current balance can cover the exact 0.00149844 SOL debit, but the founder must retry through the authenticated UI and confirm that review opens with the same wallet-paid total. Signing is not required to close this fix criterion; it is required later to create the USDT account and continue the parent Raydium/Orca live gate.
9. **Passed.** `transactionBindsExpectedToken` accepts an expected SPL asset when either its mint or its exact canonical wallet account appears. Orca's live Whirlpool transaction passed the full structure and delta validators without weakening canonical input/output account requirements.
10. **Passed.** `simulationError` decodes rent-transfer logs and reports the exact shortfall. A deterministic test covers the observed 90,135-lamport error, and the live Raydium two-pool failure produced the matching values before signing.

## Completion rule

Do not mark this fix complete until criterion 8 is observed in the founder's authenticated UI. Do not mark the parent Raydium/Orca sponsorship block complete until its two confirmed sponsored transactions are recorded separately.

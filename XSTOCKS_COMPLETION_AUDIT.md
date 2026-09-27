# Flay xStocks completion audit

**Audited:** 2026-09-24  
**Plan:** `HACKATHON_XSTOCKS_PLAN.md`  
**Result:** superseded by the executable-route reliability fix; current evidence is in `XSTOCKS_EXECUTABLE_ROUTE_FIX_AUDIT.md`  
**Network:** Solana mainnet-beta  
**Contract deployment:** none

## Plan-versus-code result

This audit records the original implementation evidence, but a later live user check found that criterion 8 was too weak: a quote-only Jupiter response could be labeled executable before Jupiter built a wallet-bound transaction. `XSTOCKS_EXECUTABLE_ROUTE_FIX_PLAN.md` now governs completion. The original evidence below is preserved as history and does not constitute a current completion claim.

| # | Result | Implementation evidence | Verification evidence |
| --- | --- | --- | --- |
| 1 | PASS | `src/App.tsx` adds desktop/mobile Stocks navigation and mounts `src/stocks/StocksPage.tsx`. `server/stocks-service.ts` paginates the official public xStocks catalog and retains valid Solana deployments only. | Live `/api/stocks` returned `status: live`, 1,124 Solana assets, and the canonical AAPLx mint. Desktop/mobile browser audit found the Stocks page, directory, and selected official asset. |
| 2 | PASS | `StockService.detail` resolves browser symbols against the server-owned catalog; quote mints are derived from that record. Conflicting catalog/detail mints fail with `XSTOCKS_MINT_MISMATCH`. `TokenService.getOfficialStockByMint` verifies the onchain mint and the scoped Token-2022 extension policy. | `server/stocks-service.test.ts` covers absent symbols and changed official mints. `server/tokens.test.ts` covers the reviewed official extensions and rejects an unreviewed transfer-fee extension. The browser never submits a stock mint to `/stocks/quotes`. |
| 3 | PASS | `/api/stocks/:symbol` returns issuer reference price, market state, exchange, current multiplier, scheduled multiplier metadata, and timestamps. Stocks labels issuer reference separately from the Jupiter route. | Live AAPLx detail returned reference price data, Token-2022 mint decimals, and multiplier `1.0032690125398187`. Browser audit found both `Issuer reference` and `EXECUTION ROUTE`. |
| 4 | PASS | `StockService.quote` converts Buy display input with `decimalToAtomic`, fixes input to native Solana USDC, fixes output to the canonical stock mint, and passes `providers: ['jupiter']` to `QuoteService`. | Service tests assert exact `10 USDC → 10000000` atomic derivation and Jupiter-only scope. The opt-in live test returned one or more Jupiter routes for `0.58 USDC → AAPLx`. |
| 5 | PASS | Sell uses `scaledDecimalToAtomic` with decimal-string `BigInt` math, conservative floor rounding, official xStock input, and native Solana USDC output. | Amount tests cover rounding, dust, and excess precision. Service tests prove `1` displayed share at `1.25×` becomes `800000` raw units for a six-decimal fixture before Jupiter quoting. |
| 6 | PASS | `shared/stock-amounts.ts` is used for buy output, sell input, holdings, review, and Activity deltas. The multiplier snapshot is stored in `QuoteSnapshot`, propagated to `PreparedTransaction.review.stock`, written with the public Activity signature, and shown in success/reconciliation UI. | `shared/stock-amounts.test.ts` covers positive/negative conversions and precision. `src/App.test.tsx` proves raw AAPLx values render as scaled shares and minimum output in review. Live `171912` raw AAPLx units rendered as `0.001724739824` shares. |
| 7 | PASS | Stock quotes are stored in the existing `EphemeralStore`. `/api/market/prepare`, `QuoteService.prepare`, transaction structure validation, exact simulation, Privy signing, `/transactions/execute`, and sponsored completion remain the only execution path. Stock context adds review metadata without bypassing any validator. | The full existing transaction-security regression suite passes. API tests confirm `/stocks/quotes` requires Privy identity; `assertIdentityWallet` binds its wallet. |
| 8 | PASS | Zod schemas bound symbol, side, amount, slippage, and wallet. Fresh catalog/detail are required for quotes. Halted assets, dust, missing identity, insufficient balances, missing routes, stale catalogs, and expired routes disable or reject review. | Schema, stale-cache, provider-failure, arbitrary-symbol, balance, quote-expiry, and existing prepare-store tests pass. `StocksPage` updates expiry state every second and refreshes live routes on a bounded interval. |
| 9 | PASS | Successful signing stores the real Solana signature, provider, gas mode, stock symbol/side/mint/multiplier, atomic prepared values, and scaled display context. Activity fetches authoritative onchain deltas and applies the recorded multiplier to the stock mint; success links the real Explorer signature. | Existing execution/idempotency/activity tests pass. Corrupt local stock context is rejected by `isStoredStockContext`, preventing a fabricated or malformed browser receipt from rendering as stock activity. No success record is created before the real execution endpoint returns. |
| 10 | PASS | Catalog cache has explicit `live`/`stale` status, a 24-hour browse-only fallback, coalesced bounded refresh, and a fresh-data requirement for trading. Health performs a fast official probe and warms the full catalog in the background. | Stale fallback and request coalescing are tested. Live `/api/health` returned xStocks ready and provider labels `xStocks` plus `Jupiter Swap V2`; live `/api/stocks` returned 1,124 current assets. |
| 11 | PASS | The Stocks page states that xStocks are tokenized securities, availability depends on jurisdiction and issuer rules, issuer data differs from DEX execution, and Flay does not provide brokerage, issuance/redemption, dividends, shareholder rights, guaranteed liquidity, or universal access. | SSR and desktop/mobile browser tests assert the disclosures. README states that a VPN does not change eligibility. |
| 12 | PASS | xStocks uses public read APIs only. Jupiter supplies execution. Privy supplies user approval. The implementation adds no program deployment, xStocks key, sponsor key, private key, fake data, or provider fallback. | `.env.example` contains only optional public xStocks endpoint/cache tuning. Release source/bundle scan passes. Focused unfinished/mock/fake searches returned no match in shipped stock files. |
| 13 | PASS | Stocks is mounted alongside existing Convert, Futures, Funds, Activity, MagicBlock, gasless, and wallet/export flows. Convert's generic Token-2022 block remains intact; only the official stock method has the scoped extension policy. | Full suite: 41 test files passed, four opt-in live suites skipped by default; 220 tests passed and eight opt-in tests skipped. Production build and the expanded browser audit passed existing Futures/Funds/shell checks together with Stocks. |
| 14 | PASS | Reproducible commands and live test are documented in `apps/web/README.md`; environment values are documented in `.env.example`. | `npm test`: 220 passed. `npm run build`: pass, 7,704 modules transformed. `npm run browser:audit`: pass at desktop/mobile with no runtime exceptions or horizontal overflow. `npm run release:audit`: pass, 249 bundle files scanned. `LIVE_STOCKS_TESTS=1 npm test -- server/live-stocks.test.ts`: pass. `npm audit --omit=dev --audit-level=high`: exit 0 with zero moderate/high/critical findings; three MagicBlock-only low findings are explicitly reviewed in `ADVISORY_REVIEW.md`. Local health and catalog checks passed. |
| 15 | PASS | This file maps the final code and evidence after the plan was re-read. | The final focused search found no stock TODO, FIXME, preview-only path, illustrative/fake/mock trading data, or disabled stock action. Review, signing, and execution actions are wired; provider failures remain explicit and retryable. |

## Live read-only mainnet evidence

The opt-in live suite and direct read-only check ran on 2026-09-24 without signing or spending user funds:

- Official catalog: 1,124 valid Solana deployments.
- AAPLx mint: `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp`.
- Token program: Token-2022 with Scaled UI Amount and the reviewed issuer-control extensions.
- Current multiplier observed: `1.0032690125398187`.
- Exact input: `0.58 USDC` / `580000` atomic units.
- Live Jupiter route observed: `BisonFi → PancakeSwap`.
- Raw output/minimum observed: `171912` / `171052` AAPLx atomic units.
- Scaled output/minimum: `0.001724739824` / `0.001716111711` AAPLx shares.
- Provider failures: none for the passing live run.

This is read-only integration evidence. Flay did not sign, submit, or spend from the founder wallet. The implementation plan explicitly excludes an automated spend from the completion gate; real user execution remains user-approved through Privy.

## Final verification record

```text
npm test
  41 files passed; 4 opt-in files skipped
  220 tests passed; 8 opt-in tests skipped

LIVE_STOCKS_TESTS=1 npm test -- server/live-stocks.test.ts
  1 file passed; 1 live read-only test passed

npm run build
  TypeScript passed
  Vite production build passed in 38.14s

npm run browser:audit
  Desktop 1440×1000 passed
  Mobile 390×844 passed
  Stocks/Futures/Funds/shell/checkout checks passed
  Runtime exceptions: 0

npm run release:audit
  Release source and browser bundle scan passed
  249 bundle files checked

npm audit --omit=dev --audit-level=high
  Exit 0
  0 moderate, 0 high, 0 critical
  3 reviewed low MagicBlock transitive findings remain visible
```

## Completion decision

The xStocks block satisfies all requirements and all fifteen acceptance criteria in `HACKATHON_XSTOCKS_PLAN.md`. The implementation is complete under that plan. This decision does not change the separate open founder/provider gates recorded for MagicBlock, fiat, Futures, or earlier gasless blocks.

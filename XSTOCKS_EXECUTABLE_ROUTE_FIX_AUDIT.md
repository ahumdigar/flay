# Flay xStocks executable-route reliability audit

**Audited:** 2026-09-24  
**Plan:** `XSTOCKS_EXECUTABLE_ROUTE_FIX_PLAN.md`  
**Result:** all eight acceptance criteria pass  
**Network:** Solana mainnet-beta  
**Signed or submitted transaction:** none

## Plan-versus-code result

The complete fix plan was compared with the final repository after implementation. The standalone plan and the block embedded in `agent.md` are byte-for-byte equivalent after trimming. The shipped stock path contains no TODO, FIXME, preview-only action, mock/fake quote, price, balance, or trade.

| # | Result | Implementation evidence | Verification evidence |
| --- | --- | --- | --- |
| 1 | PASS | `StockService.quote` supplies the authenticated `executionWallet` and `jupiterMode: 'router'`. `JupiterAdapter.quote` calls `/swap/v2/build`, validates the response, assembles a v0 transaction, and completes a mainnet simulation before returning a quote. `StocksPage` displays `LIVE` only when that quote exists. | The live `0.01 USDC → AAPLx` check returned `Jupiter Swap V2 Router` only after a real transaction was assembled and simulated. Malformed and unexpected-tip responses are rejected in `server/providers/jupiter.test.ts`. |
| 2 | PASS | Quote cache/in-flight keys include execution wallet and Jupiter mode. `QuoteService.prepare` and `JupiterAdapter.prepare` both reject a bound-wallet mismatch with `QUOTE_WALLET_MISMATCH`. | `server/quote-service.test.ts` proves a second wallet cannot prepare the stored executable route. `server/stocks-service.test.ts` proves wallet propagation. |
| 3 | PASS | Stocks uses the Router build path rather than Meta-Aggregator `/order`. `maxAccounts=32` keeps the live route compact after the default and 40-account paths admitted rent-heavy multi-hop routes. Simulation maps a real rent/SOL shortfall to an exact actionable amount. | The original Meta-Aggregator request reported `Minimum $5 for gasless`. The final live route built and simulated `0.01 USDC → AAPLx` as a direct Raydium CLMM route for the founder wallet. No generic `Failed to get quotes` remained in this path. |
| 4 | PASS | `/build` receives the chosen `slippageBps`; response slippage and `otherAmountThreshold` become the public route and review minimum. Scaled share estimates use the same raw output/minimum. | Final live evidence returned 50 bps, raw output `2964`, raw minimum `2950`, scaled output `0.000029736893`, and scaled minimum `0.000029596435` for the observed multiplier snapshot. |
| 5 | PASS | The built transaction is stored in the expiring quote snapshot and reused during preparation. Preparation still runs `validateTransactionStructure` and `simulateAndVerifyDeltas`, verifies signer, fee payer, canonical input/output accounts, route pool, programs, exact input, and minimum output, and records RPC submission mode. | A final live read-only full `StockService.quote → QuoteService.prepare` run passed. Review reported a 572-byte transaction, Raydium CLMM route, exact `10000` USDC atomic input, `2964/2950` output/minimum, and approximately `0.001564721 SOL` total debit (`0.000005161` gas plus `0.00155956` rent/other transaction-required SOL). |
| 6 | PASS | Router mode is requested only by Stocks. Convert keeps the existing quote-only Meta-Aggregator and `/order` + `/execute` path. Futures, Funds, Activity, MagicBlock, sponsorship boundaries, and wallet export were not broadened. | Full regression suite passed: 41 files and 223 tests, with four opt-in files/eight opt-in tests skipped by default. Browser audit passed Convert/Futures/Funds/Stocks/shell checks with no runtime exceptions. |
| 7 | PASS | README documents the wallet-bound Router, compact-route cap, self-funded gas/rent, validation, and execution boundary. Health reports `Jupiter Swap V2 Router` for Stocks. | TypeScript and production build passed with 7,704 modules. Live xStocks test passed. Release audit passed 249 bundle files. Desktop/mobile browser audit passed without stock overflow. Local `/api/health` was ready. `npm audit --omit=dev --audit-level=high` exited 0; only the three already-reviewed low MagicBlock transitive findings remain. |
| 8 | PASS | This audit maps every criterion to final code and current evidence after the focused source scan and plan comparison. | Plan/embedded comparison returned `exact: true` with 36 lines each. The focused unfinished/mock/fake/preview search returned no match. |

## Live read-only evidence

The live acceptance used founder wallet `FexVX…nLMc7`, official AAPLx mint `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp`, exact input `0.01 USDC`, and 0.5% slippage. Jupiter Router selected a compact direct Raydium CLMM path and Flay simulated the assembled transaction twice: once before labeling the route live and once through the existing Review security boundary. No key was accessed, no signature was requested, and no transaction was submitted.

## Final verification record

```text
npm test
  41 files passed; 4 opt-in files skipped
  223 tests passed; 8 opt-in tests skipped

LIVE_STOCKS_TESTS=1 npm test -- server/live-stocks.test.ts
  1 file passed; wallet-bound small-value Router check passed

npm run build
  TypeScript passed
  Vite production build passed; 7,704 modules transformed

npm run browser:audit
  Desktop and mobile Stocks passed
  Convert/Futures/Funds/shell regressions passed
  Runtime exceptions: 0

npm run release:audit
  249 bundle files passed

npm audit --omit=dev --audit-level=high
  Exit 0; 0 moderate/high/critical findings
  3 reviewed low MagicBlock transitive findings remain visible
```

## Completion decision

All eight acceptance criteria in `XSTOCKS_EXECUTABLE_ROUTE_FIX_PLAN.md` pass against the final code and current evidence. The reliability fix is complete. A real purchase still requires the user to approve the exact reviewed Privy transaction; this audit did not sign or spend funds.

# Futures RPC resilience and Phoenix entry correction audit

**Status:** complete — all thirteen acceptance criteria passed  
**Date:** 2026-09-25  
**Plan:** `FUTURES_RPC_RESILIENCE_AND_ENTRY_FIX_PLAN.md`

## Incident result

The long shown in `/storage/emulated/0/hackthon/huvfd.jpg` was not submitted. Phoenix's authoritative trader endpoint initially reported collateral `1020000` and no position for `FexVXRLxhSgV2yW2VSJ54WQ3T58KQUr2Kikvr43nLMc7`, proving that attempt did not lose funds. After the correction, the founder retried and Flay reported success. Phoenix now authoritatively reports a SOL long in subaccount 1 with one base lot, entry price $117.50, and remaining collateral `1019588`. Flay health metrics recorded one successful Phoenix build, two successful simulations, one successful submission, and one completed reconciliation with no failures.

## Plan-to-code comparison

| # | Acceptance criterion | Result | Evidence |
|---|---|---|---|
| 1 | Wallet RPC throttling cannot hide healthy Phoenix state | Pass | `FuturesService.portfolio` loads wallet balances independently from venue portfolios. A focused test forces the wallet RPC to fail and still receives Phoenix collateral `1020000`. |
| 2 | Missing values are unavailable, while authoritative zero remains zero | Pass | Shared portfolio balance fields are nullable; `FuturesPage` renders `Unavailable` for missing values and retains exact zero formatting. UI unit tests cover both states. |
| 3 | Phoenix state is shared, bounded, and request-deduplicated | Pass | `PhoenixStateCache` implements fresh/stale windows, retry pacing, maximum size, and in-flight deduplication. Focused tests cover concurrent reads. A same-service live probe completed its second quote in 419 ms without another Phoenix state burst. |
| 4 | Stale fallback is bounded and honest | Pass | Retryable failures may return bounded cached state with an explicit stale flag and route warning. Missing or expired state remains unavailable and ineligible. Cache tests cover retry and expiry. |
| 5 | Writes invalidate cached wallet state | Pass | Successful onboarding and transaction submission call `invalidateWalletState`; generation tracking prevents an older in-flight request from repopulating invalidated state. Focused tests cover the next fresh read. |
| 6 | 1.020000 Phoenix collateral remains usable if wallet RPC fails | Pass | The forced-wallet-failure portfolio test retains `1020000`. A live quote probe returned Phoenix as eligible and recommended with the same authoritative collateral. |
| 7 | Final transaction safety remains strict | Pass | Entry preparation still refreshes the route, validates the provider transaction and reviewed fields, runs Solana simulation, and returns the exact message for embedded-wallet signing. Existing transaction review and safety tests pass. |
| 8 | Local server automatically recovers with a durable log | Pass | `npm run dev:supervised` runs the server through `scripts/dev-supervisor.sh`. Terminating the live Node child produced exit code 143 in `/data/data/com.termux/files/usr/tmp/flay-dev.log`, restarted after two seconds, and returned a healthy `/api/health` response. |
| 9 | Required automated validation passes | Pass | Final full suite: 42 files passed, 4 skipped; 239 tests passed, 8 skipped. TypeScript, production build, release audit, browser audit, and post-restart live health all passed. Browser audit reported no runtime exceptions. |
| 10 | Founder authenticated long retry | Pass | The founder reported the signed entry successful. Phoenix independently confirms a SOL long with one base lot at a $117.50 entry, and Flay metrics confirm successful build, simulation, submission, and reconciliation. |
| 11 | Atomic collateral is not multiplied again | Pass | `phoenixCollateralAtomic` preserves provider integer units. Tests prove `1020000` remains `1020000`, and the live probe displayed it as 1.020000 USDC. |
| 12 | Slow GMTrade cannot age out a current Phoenix quote | Pass | Phoenix freshness is calculated from the order book used for the quote. GMTrade is bounded to five seconds, and a cold live probe still returned Phoenix as eligible and recommended. |
| 13 | Background RPC throttling cannot terminate the app | Pass | `installProcessSafety` contains only recognizable Solana JSON-RPC rate-limit rejections and emits a fixed non-secret diagnostic. A real child-process probe survived a 429; the unknown-error probe exited with code 1 so the supervisor retains fail-fast recovery. Focused tests cover both classifications. |

## Validation record

- `npx tsc --noEmit`: passed.
- `npm test`: passed with 239 passing and 8 skipped tests.
- `npm run build`: passed; 7,703 modules transformed.
- `npm run release:audit`: passed; 246 browser bundle files scanned.
- `npm run browser:audit`: passed on desktop and mobile, including truthful data-state checks and zero runtime exceptions.
- `GET /api/health`: returned `status: ok` after a forced supervised restart.
- Live Phoenix probe: authoritative collateral `1020000`, Phoenix eligible and recommended; repeat quote 419 ms.
- Founder entry probe: authoritative SOL long, one base lot, $117.50 entry, remaining collateral `1019588`.
- Process-safety probes: Solana JSON-RPC 429 survived; unknown invariant failure exited with code 1.

## Completion decision

The plan and actual implementation match all thirteen acceptance criteria. The authenticated end-to-end Phoenix entry succeeded and was independently verified against authoritative venue state. This correction is 100% complete.

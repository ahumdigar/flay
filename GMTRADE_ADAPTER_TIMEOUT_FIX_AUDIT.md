# Flay GMTrade adapter timeout correction audit

**Status:** complete  
**Date:** 2026-09-27  
**Plan:** `GMTRADE_ADAPTER_TIMEOUT_FIX_PLAN.md`

## Root cause and final behavior

The screenshot showed a genuine supervisor recovery message caused by an incorrect local runtime default. A mainnet GMTrade portfolio read for the founder wallet took 7.7 seconds during diagnosis and 10.7 seconds during final verification. `GmTradeAdapter` killed any request after five seconds unless an environment override happened to be present, even though `.env.example` documented a 15-second timeout. The killed sidecar then produced the screenshot's temporary recovery error for nearby requests.

The runtime default is now the documented bounded 15 seconds. A real stall still fails closed and restarts the child after the existing cooldown. Transaction-building requests remain single-attempt and cannot be duplicated by recovery logic.

## Acceptance-criteria mapping

### 1. Default timeout is 15 seconds — passed

- `apps/web/server/futures/gmtrade-adapter.ts` defines `DEFAULT_REQUEST_TIMEOUT_MS = 15_000` and uses it whenever `GMTRADE_ADAPTER_TIMEOUT_MS` is absent or invalid.
- The existing 100 ms minimum and 30-second maximum clamp remain unchanged.
- `apps/web/.env.example` already documents `GMTRADE_ADAPTER_TIMEOUT_MS=15000`, so runtime behavior and setup documentation now agree.
- `apps/web/server/futures/gmtrade-adapter.test.ts` removes the override, constructs the adapter, and verifies the resolved default is exactly 15,000 ms.

### 2. Founder-wallet portfolio completes without false recovery — passed

- The final default-configured `GmTradeAdapter.portfolio` mainnet probe for `FexVX…nLMc7` returned `available: true` in 10,673 ms.
- Adapter diagnostics for that probe reported one request, zero failures, no last failure, and a running sidecar.
- This exact request exceeded the former five-second limit and completed inside the corrected bound.

### 3. Real stalls fail closed and transaction building is not retried — passed

- `command` retains its bounded timeout, pending-request cleanup, child termination, failure metrics, and one-second restart cooldown.
- `prepareAction` still calls `command` exactly once and contains no automatic retry.
- Focused tests verify an unresponsive process is killed, a request during cooldown is rejected, a crashed process restarts after cooldown, and a crashed `prepare_action` records exactly one request and one failure.

### 4. Restarted local GMTrade service is healthy — passed

- The supervised local server was restarted after the code change.
- Final `/api/health` evidence reports GMTrade public data and execution ready with adapter version 0.10.0 at pinned revision `7ce035b`.
- Process diagnostics report six requests, zero failures, no last failure, and a running binary.
- The GMTrade entry circuit reports zero consecutive failures and `open: false`.

### 5. Final verification — passed

- Focused Futures recovery checks: 3 files and 28 tests passed.
- Full `npm run check`: the production TypeScript/Vite build passed; 42 test files passed, 4 were intentionally skipped; 255 tests passed and 8 were intentionally skipped.
- `npm run release:audit`: passed, including 246 built browser files.
- `npm run browser:audit`: passed at 1440×1000 and 390×844 with Futures controls, portfolio recovery access, route controls, responsive layout, and no runtime exceptions.
- The first browser-audit attempt hit a Chrome debugging-session `Promise was collected` harness error; the immediate clean rerun passed. This did not originate from application code.
- The supervised local app remains running at `http://127.0.0.1:5173`.

## Plan comparison

Every implementation item and acceptance criterion in `GMTRADE_ADAPTER_TIMEOUT_FIX_PLAN.md` is present in the final code and verified above. No planned safety boundary, timeout clamp, recovery control, or transaction rule was removed.

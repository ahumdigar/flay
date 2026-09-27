# GMTrade degraded-state recovery correction audit

**Status:** complete — all six acceptance criteria passed  
**Date:** 2026-09-25  
**Plan:** `GMTRADE_DEGRADED_RECOVERY_FIX_PLAN.md`

## Screenshot diagnosis

`/storage/emulated/0/hackthon/kyfzmzkskt.jpg` shows the same temporary GMTrade portfolio warning, while the footer simultaneously reports `GMTrade adapter 0.10.0 ... is ready`. The route control says `Awaiting quote` and the entry button says `No executable route`, so this screenshot was captured while a route refresh had not returned. It does not show an actual GMTrade position-data loss: Flay retained the existing position count and recovery controls.

The live health check after restarting the supervised app reports GMTrade `ready`, sidecar `running: true`, and zero current sidecar failures. The warning in the screenshot was a cached result from the adapter's restart window. The recovery change now retries venue state promptly.

## Plan-to-code comparison

| # | Acceptance criterion | Result | Evidence |
|---|---|---|---|
| 1 | A degraded venue schedules an authenticated retry within five seconds | Pass | `futuresPortfolioRefreshDelay` returns 5,000 ms when any venue has an error. Focused tests cover degraded, healthy, and unloaded portfolio states. |
| 2 | A successful retry replaces degraded data and clears its warning | Pass | The authenticated portfolio effect replaces portfolio state and clears the request error on success; the next computed delay returns to 60 seconds. The application retries without reload. |
| 3 | Healthy state retains its 60-second refresh | Pass | Focused tests verify the healthy-state delay is 60,000 ms. |
| 4 | The degraded warning has a manual Retry now action and retains cached data | Pass | `VenueError` renders a Retry now button, and the portfolio state remains intact while incrementing only the refresh nonce. Focused rendering test verifies the button and cached-state text. |
| 5 | Phoenix and GMTrade recovery data remains visible | Pass | Retry does not clear or replace portfolio data before the request returns. Existing browser audit confirms portfolio visibility on desktop and mobile. |
| 6 | Required checks pass | Pass | Full suite: 42 files passed, 4 skipped; 243 tests passed, 8 skipped. TypeScript, production build, release audit, browser audit, and live `/api/health` passed. |

## Validation record

- Focused UI and sidecar tests: 18 passed.
- Full suite: 42 files passed, 4 skipped; 243 tests passed, 8 skipped.
- TypeScript and production build passed; 7,703 modules transformed.
- Release audit passed; 246 bundle files scanned.
- Browser audit passed for desktop and mobile with zero runtime exceptions.
- Local supervised server health: `status: ok`; GMTrade `ready`; process running; zero current failures.
- The screenshot’s `Awaiting quote` label confirms it was captured before a route refresh completed.

## Completion decision

All six acceptance criteria match the implementation and verification evidence. GMTrade degraded-state recovery is 100% complete.

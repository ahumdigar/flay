# Futures mobile position visibility correction audit

**Status:** complete — all six acceptance criteria passed  
**Date:** 2026-09-25  
**Plan:** `FUTURES_POSITION_VISIBILITY_FIX_PLAN.md`

## Diagnosis

The screenshot did contain the live position: `Positions 1`, `SOL-PERP`, `long`, and `phoenix`. Its remaining fields and Manage action were hidden to the right because the mobile portfolio row had a fixed 700-pixel minimum width. The footer independently displayed anonymous Phoenix readiness, which contradicted the authenticated account state.

## Plan-to-code comparison

| # | Acceptance criterion | Result | Evidence |
|---|---|---|---|
| 1 | Every position value and Manage fit at 390 px | Pass | The mobile row now uses a two-column `minmax(0,1fr)` card with no fixed minimum width. The browser probe reports `portfolioRowFits`, `portfolioTableFits`, and `portfolioActionVisible` as true at 390 px. |
| 2 | Mobile values have visible labels | Pass | Market, Side, Venue, Size, Entry, and Unrealized PnL use `data-label`; mobile CSS renders those labels. Unit rendering and the browser pseudo-element check pass. |
| 3 | The Phoenix position remains manageable | Pass | `PositionRow` retains the authoritative venue and position identifiers through its parent and connects `Manage position` to the existing `openPosition` dialog flow. The rendered fixture verifies SOL-PERP, Phoenix, size, entry, PnL, and action. |
| 4 | Authenticated Phoenix readiness replaces anonymous guidance | Pass | `phoenixReadinessDisplay` prefers wallet-specific `PhoenixAccess`. Its focused test proves active wallet access renders `Phoenix execution is active` even when the anonymous registry says onboarding is required. |
| 5 | Desktop rows remain compact | Pass | The original seven-column desktop grid remains unchanged. Browser audit reports the desktop row fits, labels stay hidden, and the action remains visible. |
| 6 | Required validation passes | Pass | TypeScript, 241 full tests, production build, release audit, responsive browser audit, and post-restart live health passed with no browser runtime exceptions. |

## Validation record

- Focused Futures UI tests: 12 passed.
- Full suite: 42 files passed, 4 skipped; 241 tests passed, 8 skipped.
- TypeScript and production build: passed; 7,703 modules transformed.
- Release audit: passed; 246 browser bundle files scanned.
- Browser audit: desktop and 390 px mobile passed; mobile card fits, labels are visible, Manage is visible, and the table has no inner horizontal overflow.
- Local supervised server: restarted and `/api/health` returned `status: ok`.

## Completion decision

The plan and actual implementation match all six acceptance criteria. The mobile position visibility and authenticated Phoenix readiness correction is 100% complete.

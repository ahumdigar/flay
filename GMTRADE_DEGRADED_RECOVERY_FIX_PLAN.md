# GMTrade degraded-state recovery correction

**Status:** complete  
**Date:** 2026-09-25  
**Scope:** clear transient Futures venue warnings promptly after adapter recovery

## Proven failure

GMTrade's supervised sidecar can briefly reject a portfolio request during its one-second restart window. The server correctly returns cached venue data and an honest degraded warning, but the Futures UI waits its normal 60-second portfolio interval before checking again. The sidecar is already healthy while the stale warning remains visible.

## Implementation

1. Derive the portfolio refresh delay from the returned venue state: use the normal 60-second interval when healthy and a five-second recovery interval while any venue reports an error.
2. Return to the normal interval immediately after a successful portfolio refresh clears the venue error.
3. Add an explicit `Retry now` control to a degraded venue warning without clearing cached positions or recovery controls.
4. Add focused timing and rendering assertions, then run TypeScript, full tests, production build, release audit, browser audit, and live health.

## Acceptance criteria

1. A transient GMTrade portfolio error schedules another authenticated portfolio request within five seconds.
2. A successful retry replaces the degraded portfolio and removes the warning without requiring a page reload.
3. Healthy portfolios retain the 60-second background interval.
4. The warning exposes a usable `Retry now` action while cached data remains visible.
5. Phoenix and GMTrade position, order, and recovery state are not cleared during the retry.
6. Focused and full tests, TypeScript, production build, release audit, browser audit, and local health pass.

## Completion rule

Compare all six criteria with actual code and evidence before declaring this correction 100% complete.

# Futures mobile position visibility correction

**Status:** complete  
**Date:** 2026-09-25  
**Scope:** readable Futures portfolio rows on small screens and wallet-specific Phoenix readiness

## Proven failures

1. `/storage/emulated/0/hackthon/htvvf.jpg` shows `Positions 1`, `SOL-PERP`, `long`, and `phoenix`, but the fixed 700-pixel row pushes size, entry, PnL, and Manage off the right edge behind an unlabeled horizontal scroll area.
2. The same authenticated screen says `Phoenix: Wallet onboarding is required` because it renders anonymous registry readiness even though wallet-specific access and the live Phoenix position prove execution is active.

## Implementation

1. Give position, order, and history values explicit field labels so compact rows remain understandable without a desktop header.
2. Replace the small-screen fixed-width portfolio row with a responsive card grid that keeps market, side, venue, size, entry or price, PnL or status, and action visible inside the viewport.
3. Preserve the current compact desktop row layout and all existing position management actions.
4. Prefer authenticated wallet-specific Phoenix access for the readiness label and state. Use anonymous registry readiness only until wallet access is available.
5. Add focused rendering and responsive browser assertions, then run TypeScript, full tests, production build, release audit, browser audit, and live health.

## Acceptance criteria

1. On a 390-pixel viewport, every live-position value and the Manage button fit without horizontal portfolio scrolling.
2. Size, entry, and unrealized PnL have visible labels on the mobile card.
3. The active SOL-PERP long remains attributed to Phoenix and opens the existing management dialog.
4. An execution-eligible authenticated Phoenix account displays `Phoenix execution is active` with a ready state instead of anonymous onboarding guidance.
5. Desktop portfolio rows remain compact and functional.
6. Focused and full tests, TypeScript, production build, release audit, browser audit, and local health pass.

## Completion rule

Compare all six criteria with actual code and evidence before declaring this correction 100% complete.

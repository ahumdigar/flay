# Flay stock-directory visibility fix

**Status:** implementation complete; evidence in `STOCK_DIRECTORY_VISIBILITY_FIX_AUDIT.md`  
**Date:** 2026-09-24

## Problem

The server returns 1,124 official Solana xStocks and verified featured assets load correctly, but the interface defaults to Apple. On narrow screens the full directory appears below the Apple trade ticket, so users can reasonably conclude that Apple is the only supported stock.

## Implementation

1. Keep Apple as the initial asset but add an immediately visible featured-stock switcher to the trade card.
2. Include Apple, NVIDIA, Tesla, Microsoft, Amazon, Alphabet, Meta, SPY, and QQQ when present in the official catalog.
3. Show the full official catalog count and provide an `All stocks` action that scrolls to the searchable directory.
4. Increase the default directory preview while preserving search across the complete server-returned catalog.
5. Keep canonical server-side mint selection, quoting, and transaction security unchanged.
6. Verify responsive rendering, featured selection, full-catalog search, tests, build, and local runtime.

## Acceptance criteria

1. The Stocks screen visibly communicates that more than Apple is supported before the user scrolls.
2. Every featured button is derived from the official catalog and changes the selected trade asset.
3. Search still filters all 1,124 current catalog entries rather than only the preview.
4. Desktop and mobile remain free of horizontal overflow.
5. Existing stock execution and application regressions pass.

## Completion rule

Compare all five criteria with final code and current verification before declaring this visibility fix complete.

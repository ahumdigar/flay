# Flay xStocks catalog recovery fix

**Status:** complete — see `XSTOCKS_CATALOG_RECOVERY_FIX_AUDIT.md`  
**Date:** 2026-09-25  
**Scope:** official xStocks catalog availability and Stocks unavailable state

## Problem

The Stocks directory can remain empty after a local server restart even though the official xStocks API is available. The server fetches broad catalog pages in parallel with a generic ten-second timeout and automatic retry. When xStocks is temporarily slow, the requests time out before a catalog cache exists, and the browser shows `Connecting to official data` plus an unhelpful `Choose an xStock` detail panel.

## Implementation

1. Request the official xStocks catalog with the documented Solana network filter and an explicit bounded page size, while retaining bounded schema validation, pagination, canonical Solana-mint checks, and the existing official-data-only trust boundary.
2. Load one official, server-validated AAPLx record first so the Stocks screen has a usable authentic asset while the full directory refreshes in the background. Label that partial directory honestly and replace it with the complete bounded catalog only after every page succeeds.
3. Fetch the full catalog in bounded background page batches so a provider pause does not create a large concurrent burst. Retry incomplete directory work only when the browser requests the existing partial cache; give each background catalog request a bounded catalog-specific timeout without multiplying an individual request through an automatic second attempt. The initial asset, detail, multiplier, and reference-price requests retain the short generic timeout.
4. Preserve live and bounded stale-cache behavior. Never create local stock records, prices, mints, routes, balances, or receipts when official data is unavailable.
5. Make the Stocks provider label and both panels report catalog failure clearly, retain a usable refresh action, and avoid implying that the user merely failed to choose an asset.
6. Add deterministic tests for the exact catalog request contract, initial official asset, background directory behavior, and unavailable-state interface, then run focused tests, the full test suite, production build, release audit, and a live local API check.

## Acceptance criteria

1. Catalog URLs contain `network=Solana`, `page`, and a bounded `pageSize`; only validated official Solana deployments enter the catalog.
2. A cold server returns a validated official AAPLx record promptly and labels the directory as still loading; it does not invent an asset, mint, price, balance, route, or trade.
3. A temporarily slow complete-catalog request receives one bounded catalog-specific attempt in a small background page batch, then retries safely on a later partial-cache request rather than two generic timeout windows or a large concurrent burst; all existing page, byte, asset, and malformed-response limits remain enforced.
4. A live, partial, complete, or permitted stale official catalog remains the sole source of selectable symbols; an absent catalog cannot enable stock detail, quote, review, or execution.
5. A failed catalog visibly says official data is unavailable and supplies `Retry catalog` from both the directory and the empty trade panel.
6. Focused and full tests, TypeScript/production build, release audit, and a live local `/api/stocks` request pass. The completion audit compares every criterion with final code before any completion claim.

## Completion rule

Do not declare this correction complete until every acceptance criterion is mapped to code and verification evidence in `XSTOCKS_CATALOG_RECOVERY_FIX_AUDIT.md`. A provider outage must remain visible as an unavailable state rather than being hidden by sample or cached data outside the permitted stale window.

# Flay xStocks visible-price batch expansion audit

**Status:** complete  
**Date:** 2026-09-27  
**Plan:** `XSTOCKS_PRICE_BATCH_EXPANSION_PLAN.md`

## Final behavior

The Stocks workspace keeps all 1,124 validated official Solana xStocks searchable. Its initial directory now places twelve canonical assets with live market references first: AAPL, NVDA, TSLA, MSFT, AMZN, GOOGL, META, SPY, QQQ, NFLX, AVGO, and COIN. All twelve directory prices are fetched through one bounded Jupiter Price V3 request. A selected asset independently checks and prefers its xStocks issuer reference when that endpoint responds.

Official long-tail assets remain searchable. If neither verified provider has a current price, the row explicitly says `Unavailable` and `No live provider price`; Flay does not invent a value or use the missing reference to enable execution.

## Acceptance-criteria mapping

### 1. Process up to twelve official symbols without four-symbol truncation — passed

- `apps/web/server/stocks-service.ts` sets `MAX_REFERENCE_PRICE_SYMBOLS` to twelve and applies the same bound to both the requested symbol set and canonical Jupiter mint batch.
- `apps/web/server/schemas.ts` accepts one through twelve validated stock symbols and rejects a thirteenth.
- `apps/web/server/stocks-service.test.ts` verifies the twelve-symbol schema boundary and a complete twelve-result service response.

### 2. Price all twelve visible rows through one bounded provider batch — passed

- `StockService.referencePrices` resolves browser-provided symbols only through the official catalog, reuses valid cached prices, and sends all missing canonical mints through one `jupiterMarketPrices` call.
- Directory pricing no longer waits on twelve separate issuer endpoints. Issuer preference remains in `loadDetail` for the selected asset.
- The twelve-asset regression test asserts twelve returned values and exactly one provider call.
- A fresh local mainnet request returned 12 of 12 prices in 427 ms with HTTP 200 and no missing symbols.

### 3. Preserve the canonical-mint trust boundary — passed

- `referencePrices` constructs its symbol-to-asset map from `catalog.assets`; unknown symbols are discarded before provider access.
- `jupiterMarketPrices` accepts normalized `StockAsset` records and derives request mints from those server-validated records. The API never accepts a stock mint from the browser.
- The catalog continues validating each Solana deployment with `PublicKey` before it becomes selectable.

### 4. Show priced assets first while retaining honest full-catalog search — passed

- `apps/web/src/stocks/StocksPage.tsx` defines the twelve verified featured symbols, orders them first, and renders exactly twelve default directory rows.
- Search still scans the complete official catalog and displays up to 24 matches.
- Missing provider prices render as `Unavailable` with `No live provider price`, while halted and closed reference states remain visible.
- `apps/web/scripts/browser-audit.mjs` waits for all twelve default rows to contain actual prices and separately verifies a non-featured full-catalog search on desktop and mobile.

### 5. Keep price sources and executable routes distinct — passed

- API price records preserve `xstocks` or `jupiter` source metadata.
- The UI labels values as `Issuer reference` or `Market reference` and explains that executable price, liquidity, impact, and minimum output come from Jupiter.
- Stock quote construction still uses the existing exact Jupiter router path, authenticated wallet, canonical mint, amount, and slippage. A displayed reference price cannot create or authorize a transaction.

### 6. Final verification — passed

- Focused Stocks tests: 21 passed.
- Full `npm run check`: production TypeScript/Vite build passed; 42 test files passed, 4 were intentionally skipped; 253 tests passed and 8 were intentionally skipped.
- `npm run release:audit`: passed, including 246 browser bundle files.
- `npm run browser:audit`: passed for 1440×1000 and 390×844. Both reported all twelve popular symbols, `initialPricesVisible: true`, working full-catalog search, no Stocks horizontal overflow, and no runtime exceptions.
- Shipped Stocks source scan found no TODO, FIXME, fabricated quote, sample price, or preview-only execution behavior.
- The supervised local app is running at `http://127.0.0.1:5173`.

## Plan comparison

Every implementation item and acceptance criterion in `XSTOCKS_PRICE_BATCH_EXPANSION_PLAN.md` is represented in the final code and verification above. No requirement was removed or weakened to close the plan.

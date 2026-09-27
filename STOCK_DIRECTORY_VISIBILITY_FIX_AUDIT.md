# Flay stock-directory visibility fix audit

**Status:** complete  
**Date:** 2026-09-24  
**Plan:** `STOCK_DIRECTORY_VISIBILITY_FIX_PLAN.md`

## Result

The Stocks screen no longer presents Apple as if it were the only supported asset. Apple remains the initial selection, while a visible switcher exposes nine popular official xStocks and an `All stocks` action. The live server currently reports 1,124 official Solana xStocks, and the directory search continues to filter the complete catalog before applying its display limit.

## Plan-to-code comparison

1. **Visible featured-stock switcher:** implemented in `apps/web/src/stocks/StocksPage.tsx:303`. It is rendered above the selected stock hero, so it is visible before the directory on narrow layouts.
2. **Nine requested assets:** `AAPLx`, `NVDAx`, `TSLAx`, `MSFTx`, `AMZNx`, `GOOGLx`, `METAx`, `SPYx`, and `QQQx` are the preferred symbols. `featuredAssets` resolves them from the server-returned catalog rather than creating local asset or mint records (`StocksPage.tsx:146`).
3. **Catalog count and directory action:** the switcher displays the live catalog count and its `All stocks` button scrolls to `#stock-directory` (`StocksPage.tsx:303-320`). The directory also labels its source and complete count (`StocksPage.tsx:275-295`).
4. **Larger preview and complete search:** the default directory preview is 12 and search results are 24, but filtering occurs over `catalog.assets` before either limit is applied (`StocksPage.tsx:132-144`).
5. **Execution boundary preserved:** canonical asset detail, authenticated wallet-bound quote, selected quote, and `/market/prepare` behavior remain in their existing path (`StocksPage.tsx:165-211` and `240-260`). This change added discovery controls only.
6. **Responsive and runtime checks:** switcher wrapping and the mobile three-column layout are in `apps/web/src/stocks/stocks.css`; desktop and 390 px browser audits both report no horizontal overflow.

## Acceptance criteria

1. **More than Apple is visible before scrolling — PASS.** Desktop and mobile browser audits found all nine popular buttons plus `All stocks`.
2. **Featured choices are official and selectable — PASS.** Every button is derived from the official catalog map. The browser audit clicked `NVDA` and verified the active control and `NVIDIA xStock` detail on desktop and mobile.
3. **Search covers the complete current catalog — PASS.** The implementation filters the entire `catalog.assets` array before slicing. The browser audit fetches a current non-featured asset from `/api/stocks`, searches for its official symbol, and verifies it appears in the directory on desktop and mobile. The live API reported 1,124 assets.
4. **Responsive rendering — PASS.** Browser audits at 1440×1000 and 390×844 both reported `noHorizontalOverflow: true` for Stocks.
5. **Regressions — PASS.** The full unit/integration suite, type check, production build, release scan, and complete browser regression audit passed.

## Verification evidence

- Focused tests: `npm test -- src/stocks/StocksPage.test.tsx server/stocks-service.test.ts` — 2 files and 11 tests passed.
- Full tests: `npm test` — 41 files passed, 4 skipped; 224 tests passed, 8 skipped.
- TypeScript and production build: `npm run build` — passed; Vite transformed 7,704 modules.
- Release scan: `npm run release:audit` — passed; 249 bundle files checked.
- Browser audit: `npm run browser:audit` — passed all application checks; both stock viewports exposed the nine featured assets, changed to NVIDIA, searched beyond the preview, displayed the catalog count, and had no runtime exception or horizontal overflow.
- Live runtime: `GET /api/health` returned `status: ok` with xStocks ready and `assetCount: 1124`; `GET /api/stocks` returned 1,124 assets.
- Shipped-path scan: no stock `TODO`, `FIXME`, mock fallback, preview-only execution, or disabled stock-selection action was found. Test provider mocks and ordinary disabled/loading UI states remain intentional.

All implementation steps and all five acceptance criteria in the plan are present and verified.

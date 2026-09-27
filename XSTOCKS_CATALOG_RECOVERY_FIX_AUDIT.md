# Flay xStocks catalog recovery fix audit

**Status:** complete  
**Date:** 2026-09-25  
**Plan:** `XSTOCKS_CATALOG_RECOVERY_FIX_PLAN.md`

## Result

The Stocks page no longer depends on completing a broad xStocks directory request before it can show any usable asset. A cold server first returns a server-validated official AAPLx Solana deployment, truthfully labels the directory as updating, and fills the complete official directory in bounded background batches. If official data cannot be reached, the interface states that directly and offers a retry; it does not substitute sample stock data.

## Plan-to-code comparison

| Plan acceptance criterion | Final implementation | Evidence |
| --- | --- | --- |
| 1. Request the documented Solana catalog with bounded pages and admit only validated official Solana mints. | `fetchCatalogPage` sends `network=Solana`, `page`, and `pageSize=100`; `loadCatalog` retains bounded schema, page, asset, and conflicting-mint checks; `normalizeAsset` verifies the Solana public key. | `apps/web/server/stocks-service.ts:19-26`, `:120-148`, `:372-419`; focused server test verifies the exact URL parameters. |
| 2. Make a cold server usable quickly with one authentic asset and label the directory as partial. | `loadInitialCatalog` fetches and validates official AAPLx, caches only that record with `directoryComplete: false`, and starts the full catalog asynchronously. The endpoint warning and page label say the directory is updating. | `stocks-service.ts:335-364`; `apps/web/src/stocks/StocksPage.tsx:104-132`, `:293`, `:311`. |
| 3. Avoid a broad retry burst and retry incomplete work safely later. | Catalog work runs in coalesced batches of four, each catalog page gets one 45-second catalog-specific attempt with automatic retry disabled, and a later request of a partial cache coalesces a new refresh. Initial/detail requests retain the short general timeout. | `stocks-service.ts:100-118`, `:164-179`, `:366-419`; `apps/web/server/config.ts:43-47`; `apps/web/.env.example:19`. |
| 4. Keep official live, partial, complete, or permitted stale data as the only source for selectable assets and execution. | An unlisted symbol during partial loading receives `XSTOCKS_DIRECTORY_LOADING`; a fresh quote resolves detail first. Detail rechecks its official mint against the canonical catalog before it can request a Jupiter route. | `stocks-service.ts:181-268`, `:422-467`. |
| 5. Show a clear unavailable state and a retry action in both Stocks panels. | The provider pill, catalog panel, and empty trade panel state that official data is unavailable and expose `Retry catalog`. | `StocksPage.tsx:104-112`, `:307-311`, `:387`; `StocksPage.test.tsx:38-45`. |
| 6. Run focused and full verification, production build, release audit, browser audit, and a live API check. | All requested checks passed after the final code change. | Results below. |

## Verification

- Focused: `npm test -- server/stocks-service.test.ts src/stocks/StocksPage.test.tsx` — 2 files, 13 tests passed.
- Full quality check: `npm run check` — production build passed; test suites passed (42 passed / 4 skipped and 245 passed / 8 skipped).
- Release scan: `npm run release:audit` — passed; 246 bundle files checked.
- Browser regression: `npm run browser:audit` — passed at desktop and mobile sizes; it waits for `directoryComplete`, verifies all nine popular official assets, selection, full-directory search, and no runtime exceptions.
- Live local API: `GET http://127.0.0.1:5173/api/stocks` returned HTTP 200 with `directoryComplete: true`, 1,124 assets, and AAPLx present.
- Source scan: no TODO, FIXME, fake, mock, or preview-only marker was found in the changed Stocks service and page. The unrelated shared `authorizationMode: 'mock'` type is outside this feature and is not used as a stock-data fallback.

Every acceptance criterion in `XSTOCKS_CATALOG_RECOVERY_FIX_PLAN.md` is represented in the final code and has corresponding verification evidence above.

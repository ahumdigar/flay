# Flay xStocks asset-detail reliability fix audit

**Status:** complete  
**Date:** 2026-09-26  
**Plan:** `XSTOCKS_DETAIL_RELIABILITY_FIX_PLAN.md`

## Plan-to-code comparison

| Plan requirement | Final implementation and evidence |
| --- | --- |
| Keep canonical asset, mint, multiplier, and Token-2022 checks strict. | `StockService.loadDetail` validates the issuer asset and canonical mint, normalizes the multiplier, and obtains the token through `getOfficialStockByMint`. `quote` requires both verified token and multiplier. The focused test proves unavailable on-chain verification leaves `token: null` and quote creation fails. |
| Do not let issuer pricing hold the detail screen. | `issuerReferencePrice` has a 3.5-second, no-retry timeout. It now hands off to the separately audited Jupiter fallback when available, and otherwise uses null rather than fabricated data. |
| Bound provider work. | Detail issuer/multiplier checks use six-second no-retry requests; optional reference and on-chain display checks use 3.5 seconds. The browser cancels a detail request after eight seconds. |
| Give the user a recovery path. | `StocksPage` shows a bounded timeout error with Retry and exposes `Retry verification` when on-chain token verification is unavailable. |
| Keep execution closed during missing verification. | A displayed asset with `token: null` cannot quote, review, or execute, and is not cached as executable. |

## Verification

- Reproduced the original fault: `GET /api/stocks/AAPLx` took about 20.5 seconds and ended in HTTP 504 when the issuer price endpoint timed out.
- Focused tests: 19 passed across the Stocks service and page test files.
- Full check: production TypeScript/Vite build passed; 251 tests passed and 8 skipped.
- Release scan and browser audit passed. Browser audit reported no runtime exceptions.
- The live local AAPLx endpoint now returns HTTP 200 with a verified token, multiplier, and a truthful live fallback price when the issuer-price endpoint is slow.

All criteria in the saved plan map to final code and verification evidence.

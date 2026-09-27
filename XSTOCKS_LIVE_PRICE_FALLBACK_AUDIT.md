# Flay xStocks live-price fallback audit

**Status:** complete  
**Date:** 2026-09-26  
**Plan:** `XSTOCKS_LIVE_PRICE_FALLBACK_PLAN.md`

## Plan-to-code comparison

| Plan acceptance criterion | Final implementation | Evidence |
| --- | --- | --- |
| 1. Use a real Jupiter price if issuer pricing times out. | `jupiterMarketPrices` requests Price V3 only for canonical xStocks mints; it uses `stockData.price`, then scaled UI price, then token USD price. `loadDetail` and `referencePrices` choose this result only when the issuer result is absent. | `apps/web/server/stocks-service.ts`; focused fallback test. |
| 2. Prefer an issuer price when it exists. | Both sources are requested concurrently, and `issuerReference ?? jupiterReference` selects the official xStocks result first. | Focused preference test. |
| 3. Keep requests bounded. | Browser symbols are limited to four official catalog assets; those missing cache entries share one Jupiter Price V3 `ids` request. | `MAX_REFERENCE_PRICE_SYMBOLS = 4`; `referencePrices`; focused URL assertion. |
| 4. Label the source and keep execution price separate. | API/cache include `source`. Stocks labels xStocks data `Issuer reference` and Jupiter fallback `Market reference`; the execution section continues to show the exact route price and impact separately. | `shared/types.ts`, `StocksPage.tsx`, browser audit. |
| 5. Never create a price. | If both provider results are absent, no cache entry is returned and the UI retains `—`. Quotes still require canonical mint, multiplier, verified token, and an executable Jupiter route. | Service control flow and existing trust-boundary tests. |
| 6. Verify the complete feature. | Focused tests, full check, release scan, browser audit, and live local API checks passed. | Results below. |

## Verification

- Focused: `npm test -- server/stocks-service.test.ts src/stocks/StocksPage.test.tsx` — 19 tests passed.
- Full: `npm run check` — production build passed; 251 tests passed and 8 skipped.
- Release scan: `npm run release:audit` — passed; 246 bundle files checked.
- Browser: `npm run browser:audit` — passed on desktop and mobile with Stocks selection, full-directory search, source/reference separation, and no runtime exceptions.
- Live local endpoint: `GET /api/stocks-prices?symbols=AAPLx,NVDAx,TSLAx,MSFTx` returned HTTP 200 with Jupiter-source values for all four: AAPLx `341.4603`, NVDAx `224.9975`, TSLAx `372.59`, and MSFTx `517.91`.
- Live selected asset: `GET /api/stocks/AAPLx` returned HTTP 200 with `referencePrice: 341.4603`, `referencePriceSource: jupiter`, and the same token USD price.
- Source scan found no TODO, FIXME, fake, mock, or preview-only marker in the changed Stocks service, page, stylesheet, and shared type.

Every criterion in `XSTOCKS_LIVE_PRICE_FALLBACK_PLAN.md` is present in final code and supported by the evidence above.

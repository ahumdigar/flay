# Flay xStocks live-price fallback

**Status:** complete — see `XSTOCKS_LIVE_PRICE_FALLBACK_AUDIT.md`  
**Date:** 2026-09-26  
**Scope:** restore visible, real xStock market prices when the xStocks issuer-price endpoint is slow

## Problem

The Stocks directory displays dashes because xStocks' public issuer-price endpoint is timing out. The official asset directory and mint data remain live, and Jupiter Price V3 returns live on-chain xStock market prices promptly for the same canonical Solana mints.

## Implementation

1. Continue preferring the official xStocks issuer price when available.
2. For only already-validated xStocks Solana mints, request Jupiter Price V3 in a small bounded batch and use its live `stockData.price` as a fallback display reference; no browser-provided mint may enter this request.
3. Carry the reference source through server cache, API, and UI. Label xStocks values `Issuer reference` and Jupiter fallback values `Market reference`.
4. Use the same fallback for the selected asset and directory rows. Preserve the exact Jupiter trade quote as the only executable price.
5. Keep unavailable data unavailable. If neither source responds, show a dash; do not manufacture a price.
6. Add targeted tests, run the full quality and browser checks, then record a plan-to-code audit before claiming completion.

## Acceptance criteria

1. A price-data timeout with a valid canonical mint returns an actual Jupiter market price and `jupiter` source.
2. A normal xStocks issuer price remains preferred and is labelled `Issuer reference`.
3. Price requests are limited to four canonical directory assets per refresh and use a single Jupiter batch request.
4. The selected asset and directory show real prices with their correct source label; executable Jupiter route data remains distinct.
5. Missing values remain a dash and cannot enable a quote, review, or execution.
6. Focused tests, the full check, release scan, browser audit, and live local price responses pass. The completion audit maps every criterion before completion is declared.

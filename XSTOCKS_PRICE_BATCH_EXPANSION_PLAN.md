# Flay xStocks visible-price batch expansion

**Status:** complete — see `XSTOCKS_PRICE_BATCH_EXPANSION_AUDIT.md`  
**Date:** 2026-09-26  
**Scope:** show a live price for every stock visible in the initial directory without reintroducing provider-rate failures

## Problem

The official xStocks catalog contains more than one thousand canonical Solana assets, and the Stocks screen displays twelve at a time. The live-price endpoint retained a temporary four-symbol cap from the earlier xStocks timeout recovery. As a result, only the first four visible directory rows receive a price even though the remaining displayed assets are valid and searchable.

## Implementation

1. Set the server-side live-price batch ceiling to twelve, exactly matching the existing API validation and the initial directory page size.
2. Keep every requested symbol constrained to the verified official xStocks catalog before its canonical Solana mint can be sent to Jupiter Price V3.
3. Keep one bounded Jupiter Price V3 request per directory refresh. Preserve the issuer-price preference on the selected-asset detail path without delaying the directory through separate issuer calls. Do not add browser-side provider requests, invented values, or a price-driven execution path.
4. Preserve the selected-asset path, source labels, unavailable-state behavior, canonical mint checks, and Jupiter-only executable quote.
5. Put twelve canonical assets with a currently verified live Jupiter market reference first in the initial directory, rather than showing an unpriced long-tail asset ahead of them. Keep every official asset searchable and show an explicit unavailable state for any searched asset whose providers have no verified live price.
6. Add a regression test proving one twelve-symbol visible batch is accepted, batched once through Jupiter, and returns all twelve live prices.
7. Run focused tests, the complete check, release audit, browser audit, and a live local twelve-symbol request. Before claiming completion, create an audit mapping every acceptance criterion to the final code and evidence.

## Acceptance criteria

1. A `GET /api/stocks-prices` request accepts and processes up to twelve official stock symbols; it no longer silently truncates to four.
2. The twelve visible directory rows can each receive a real provider price in one bounded Jupiter Price V3 batch when issuer pricing is unavailable.
3. Non-catalog symbols and browser-supplied mints remain unable to reach Jupiter Price V3.
4. The default twelve directory rows are canonical stocks with a verified current live market reference; valid long-tail stocks without a provider price remain searchable and display an explicit unavailable state rather than an invented value.
5. Prices retain their actual source labels, and exact Jupiter execution quotes remain separate from reference prices.
6. Focused tests, full checks, release audit, browser audit, and a live twelve-symbol local response pass. The completion audit maps all criteria to final code before this change is declared complete.

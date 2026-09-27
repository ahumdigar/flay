# Flay xStocks integration plan

**Status:** implementation complete; evidence in `XSTOCKS_COMPLETION_AUDIT.md`  
**Provider:** xStocks public API for canonical asset data; Jupiter Swap V2 for execution  
**Network:** Solana mainnet-beta  
**Deployment rule:** no Flay smart contract and no xStocks private API credential

## 1. Objective and product boundary

Build a real Stocks surface in Flay where an authenticated user can discover supported tokenized stocks, inspect issuer reference data, obtain an executable Jupiter route, review the exact Solana transaction, sign with the embedded Privy wallet, and see the real transaction result.

The first release supports market buy and sell only. It does not claim brokerage execution, primary issuance/redemption, dividends, shareholder rights, limit orders, after-hours guarantees, or unrestricted country availability. xStocks supplies canonical asset metadata and its current Scaled UI Amount multiplier; Jupiter supplies the executable secondary-market route.

## 2. Trust and security boundary

1. Flay fetches the official xStocks public API from a fixed server-side base URL and validates every response with bounded schemas.
2. A stock is tradable only when the official catalog contains an active Solana deployment with a valid mint. Browser input can select an official symbol but cannot introduce an arbitrary stock mint.
3. The server binds each stock quote to the official mint, Solana USDC, requested side, exact atomic input, multiplier snapshot, and authenticated wallet execution path.
4. Stocks uses Jupiter only. Raydium or Orca may appear inside Jupiter's route plan, but Flay does not independently compare its Convert adapters on this surface.
5. Every transaction still passes Flay's existing provider-transaction validation, signer, fee-payer, mint, amount, minimum-output, simulation, expiry, and authenticated-wallet checks before Privy requests approval.
6. Flay never receives or stores the user's private key. No provider credential, signed transaction, identity token, or private material is logged.
7. Provider outages produce an explicit retryable state. Flay never substitutes mock assets, prices, balances, quotes, orders, or receipts.

## 3. Server design

### A. xStocks catalog service

1. Add configuration for the fixed xStocks public API base URL, request timeout, catalog cache lifetime, and detail cache lifetime.
2. Fetch every bounded page of `/public/assets`, validate the response, and retain only assets with an active Solana deployment.
3. Normalize each asset to a public Flay stock record with issuer symbol, display name, underlying ticker, type, logo, official Solana mint, deployment status, atomic-swap support, reference price/currency/time, current multiplier, next scheduled multiplier, and data freshness.
4. Fetch `/public/assets/{symbol}/price-data` and `/public/assets/{symbol}/multiplier?network=Solana` for selected-asset detail. Cache and coalesce requests so browsing does not overload the provider.
5. Validate the official mint as a Solana public key and verify the onchain mint owner through the existing token service before it can become executable.
6. Bound page count, asset count, response bytes, strings, URLs, timestamps, and numeric values. Fail closed for malformed or conflicting deployments.

### B. Stocks API

1. `GET /api/stocks` returns the normalized cached catalog and a clear degraded state when a stale cache is being used.
2. `GET /api/stocks/:symbol` returns current official detail and multiplier for one allowlisted asset.
3. `POST /api/stocks/quotes` requires the authenticated wallet, official symbol, `buy` or `sell`, decimal display amount, and slippage. The server derives both mints and the exact atomic amount.
4. Buy means exact-input native Solana USDC to the official xStock mint. Sell means the official xStock mint to native Solana USDC.
5. The quote service accepts an explicit Jupiter-only provider scope and includes that scope in cache/deduplication keys. Existing Convert behavior remains unchanged.
6. The stock quote response includes the ordinary executable quote plus the official asset/multiplier snapshot and input/output display amounts so the browser never guesses scaled quantities.
7. Existing `/api/market/prepare`, sponsored completion, and `/api/transactions/execute` endpoints remain the only market transaction boundary. Quote snapshots carry stock context through review and receipt without weakening existing validation.

## 4. Scaled UI Amount accounting

1. Treat Solana transaction amounts and Jupiter amounts as raw token atomic units.
2. Treat the stock amount shown to a user as `raw token units × active multiplier`, following Token-2022 Scaled UI Amount semantics.
3. Implement decimal-string rational math with `BigInt`; do not use binary floating-point for user amount conversion.
4. For buys, convert Jupiter's raw xStock output to scaled display shares using the quote's multiplier snapshot.
5. For sells, convert the user's scaled share input back to raw atomic input conservatively, reject zero/dust/over-precision results, and return the normalized executable display amount.
6. Apply the same multiplier logic to holdings derived from authoritative raw token balances.
7. Label issuer reference price separately from Jupiter execution price and show the multiplier timestamp. Never present reference price as a guaranteed quote.

## 5. Stocks interface

1. Add Stocks as a first-class authenticated Flay navigation destination without changing Convert, Futures, Funds, or Activity behavior.
2. Provide a searchable asset list with issuer name/ticker, logo, live reference price, status, and an explicit provider-data condition.
3. Provide an asset detail/trade panel with Buy/Sell control, decimal amount input, authoritative wallet balance, slippage control, Jupiter route state, scaled estimated receive amount, execution price, price impact, fees, minimum received, and route expiry.
4. Disable review while data is stale beyond the permitted cache, no executable Jupiter route exists, the amount is invalid, the wallet is unauthenticated, or balance is insufficient.
5. Reuse the existing transaction review, Privy signing/sponsorship, broadcast, receipt, and Activity tracking flow. The review identifies the selected xStock and Jupiter route.
6. Explain that xStocks are tokenized securities, availability depends on jurisdiction, issuer reference data can differ from DEX execution, and users must meet issuer/provider eligibility. Do not claim that a VPN changes eligibility.
7. Keep loading, empty, unavailable, retry, rejection, expiry, signing, execution, and success states understandable on desktop and mobile with keyboard-accessible controls.

## 6. Runtime and documentation

1. Add Stocks provider readiness to `/api/health` using a bounded catalog probe and report degradation truthfully.
2. Document environment variables, no-contract architecture, public-provider dependency, Jupiter dependency, scaled multiplier behavior, jurisdiction boundary, and local setup in README and `.env.example`.
3. Preserve MagicBlock as deferred/incomplete and preserve every prior plan and audit. This block must not alter MagicBlock authorization, Futures, fiat, or gasless eligibility boundaries.

## 7. Verification

1. Unit-test public response validation, pagination bounds, catalog normalization, canonical-mint enforcement, cache/coalescing, stale fallback, and provider failures.
2. Unit-test multiplier conversions in both directions, rounding, dust, over-precision, scheduled multiplier metadata, and stock balance display.
3. Unit-test buy/sell schema validation, USDC/mint derivation, Jupiter-only scoping, arbitrary-mint rejection, insufficient balances, and quote context propagation.
4. Test the Stocks interface for loading, search/select, buy/sell, executable quote, unavailable route, provider degradation, review handoff, and mobile layout.
5. Run focused tests, full tests, TypeScript and production build, release audit, dependency audit, browser audit, and local runtime health.
6. Run a live read-only Solana mainnet check proving that the official catalog resolves a real mint and Jupiter returns an executable small-value route for at least one stock. No automated test may spend user funds or sign on the user's behalf.

## 8. Acceptance criteria

1. Stocks appears as a distinct Flay destination and loads a real official xStocks Solana catalog without mock fallback.
2. Only official active Solana deployments can be quoted; an arbitrary browser-supplied mint cannot enter the Stocks execution path.
3. Asset detail shows current issuer reference data and multiplier freshness, separately labeled from Jupiter execution data.
4. Buy converts an exact USDC display amount to atomic input and returns a Jupiter-only executable quote to the canonical xStock mint.
5. Sell converts a scaled share display amount to raw xStock atomic input with deterministic conservative rounding and returns a Jupiter-only quote to native Solana USDC.
6. Estimated shares, minimum received, wallet holdings, review values, and receipt values apply the same multiplier snapshot and never treat scaled UI shares as raw token units.
7. Stock quotes flow through the existing authenticated, expiring, exact-intent prepare and transaction-validation boundary before Privy approval.
8. Review and execution cannot proceed for malformed provider data, stale/unallowlisted assets, invalid/dust amounts, insufficient funds, expired quotes, missing identity, or a non-executable route.
9. A successful execution records the real provider, Solana signature, canonical mints, atomic amounts, scaled stock amounts, and sponsor mode; failures remain retryable and never fabricate settlement.
10. Provider degradation is truthful in Stocks and `/api/health`; a stale cache is visibly identified and cannot authorize a new trade after its execution freshness limit.
11. The interface includes clear tokenized-security, jurisdiction, reference-price, and self-custody disclosures without implying brokerage, guaranteed liquidity, or universal access.
12. No custom Flay program, xStocks private API credential, Flay-held private key, fake quote, fake price, fake balance, or mock trade is introduced.
13. Existing Convert, Futures, Funds, Activity, MagicBlock, gasless, and wallet-export behavior continues to build and pass regression tests.
14. Focused tests, full tests, type checking, production build, release audit, dependency audit, browser audit, local health, and the live read-only catalog/route check pass.
15. `XSTOCKS_COMPLETION_AUDIT.md` maps every criterion to final code and evidence after a plan-versus-code search finds no shipped placeholder, preview-only execution, disabled stock action, or unhandled stock TODO/FIXME.

## 9. Completion rule

Do not call this block 100% complete, fully complete, done, or an equivalent until all fifteen criteria are compared with the actual repository and recorded in `XSTOCKS_COMPLETION_AUDIT.md`. Complete every autonomous implementation and verification step before reporting any external provider or founder-wallet constraint. A user-authorized live trade may be recorded as additional acceptance evidence, but automated completion never signs or spends user funds.

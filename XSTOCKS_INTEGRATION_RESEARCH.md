# Flay xStocks integration research

**Researched:** 2026-09-24  
**Status:** recommended MVP path identified; implementation has not started

## Recommended first release

Build Stocks as a separate Flay product surface backed by two existing services:

1. Use the public xStocks API at `https://api.xstocks.fi/api/v2` for the official asset catalog, Solana mint addresses, logos, underlying symbols, market status, reference prices, current multipliers, and scheduled multiplier changes. Public endpoints do not require an API key.
2. Use Flay's existing Jupiter Swap V2 integration for executable `USDC <-> xStock` secondary-market routes. Keep Flay's existing review, exact-message validation, Privy signing, submission, and receipt boundaries.
3. Do not deploy a Flay smart contract and do not require Backed/xStocks client onboarding for this secondary-market MVP.

A live research probe on 2026-09-24 returned an executable Jupiter quote for `0.58 USDC -> AAPLx` using the official Solana AAPLx mint `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp`. The route used Raydium CLMM. Live route availability must still be checked per asset and amount.

## Required accounting behavior

Solana xStocks use SPL Token-2022 with the Scaled UI Amount extension.

- Store and submit raw token amounts in transactions.
- Display `raw amount x active multiplier` to the user.
- Read the active and scheduled multiplier from the mint extension and cross-check it with the xStocks public multiplier endpoint.
- Refresh the multiplier at activation and pause Flay execution around a scheduled corporate-action activation window.
- Never treat a raw Token-2022 balance as the displayed equity quantity.

This is necessary for dividends, stock splits, and reverse splits.

## Product surface

- Searchable stocks and ETFs catalog sourced from the official API.
- Asset detail with issuer name, underlying ticker, reference price, onchain quote, market period, halt status, and jurisdiction disclosure.
- Buy and Sell ticket quoted in USDC.
- Holdings using multiplier-adjusted display balances and raw amounts for execution.
- Jupiter route, price impact, minimum received, venue, network fee, and gas-sponsorship result shown at review.
- Reference-price chart may use the underlying equity ticker, but must be labeled separately from the executable onchain xStock price.

## Provider boundaries

- The xStocks reference price is market data, not an executable Flay price.
- The Jupiter quote is the executable secondary-market price and may differ from the underlying reference.
- DEX liquidity can remain available outside the issuer's 24/5 issuance and redemption schedule.
- A missing or poor Jupiter route must show unavailable; Flay must not synthesize a price.

## Later second route: xChange

xChange can later become an issuer RFQ route beside Jupiter. It requires Backed/xStocks client onboarding, an API key, and a registered Solana wallet. A hard Solana quote returns a partially signed versioned transaction that the wallet co-signs and submits before the blockhash expires. The user also needs the relevant token accounts and SOL for fees unless a separately verified sponsor is added.

Do not include xChange in the first release until Flay is onboarded and can test its account-specific limits and compliance requirements.

## Alternative-provider comparison

### Ondo Stocks

Ondo is the strongest future second provider. It advertises more than 450 tokenized stocks and ETFs on Solana and uses just-in-time mint/redemption liquidity connected to traditional markets. Its API also exposes metadata, underlying and primary-market prices, OHLC data, dividends, contract addresses, multipliers, status, and streaming feeds.

It is less suitable for Flay's first hackathon release:

- Official API access requires contacting Ondo, completing onboarding, and receiving an API key.
- Direct mint and redemption requires user eligibility and KYC.
- A live Jupiter probe on 2026-09-24 rejected `0.58 USDC -> AAPLon`: Ondo tokens were restricted to JupiterZ, outside-market-hours trading was unavailable, and the minimum trade size was $1.
- Canonical mint discovery must come from Ondo or another trusted allowlist. Searching by ticker alone exposes unrelated and fraudulent lookalike tokens.

Recommended later use: add Ondo beside xStocks and request both executable quotes. Select the better valid route while respecting provider market hours, minimum size, eligibility, and canonical mint allowlists.

### Dinari dShares

Dinari has a broad catalog and a mature partner API, but its August 2026 announcement still listed Solana as a future expansion. Its integration also centers on partner onboarding, user identity verification, accounts, and compliant order flow. It is not a current drop-in Solana route for Flay.

### Superstate Opening Bell

Superstate provides actual transfer-agent-recorded shares rather than tracker certificates, but its current Solana equity catalog is small and every receiving wallet must be KYC-approved and allowlisted. It is appropriate for a regulated, permissioned investment product, not Flay's broad wallet-based stock aggregator MVP.

## Provider decision

Use xStocks first. Add Ondo second after obtaining official API access. Keep Dinari and Superstate out of the initial implementation.

## Legal and disclosure boundary

xStocks are tracker certificates that provide economic exposure and do not provide ordinary shareholder voting rights. xStocks' own exchange guide says regulatory classification and licensing requirements vary by the operator and user jurisdictions. Flay must enforce the issuer's current restricted-country policy and complete a jurisdiction review before public production distribution. The United States is prohibited by the issuer. Bangladesh was not named in the issuer's published prohibited or non-serviceable list on the research date, but that does not establish that operating the product from Bangladesh is lawful.

## Primary sources

- https://docs.xstocks.fi/developers
- https://docs.xstocks.fi/apis/openapi/assets
- https://docs.xstocks.fi/developers/multipliers
- https://docs.xstocks.fi/developers/xchange-atomic-rfq
- https://docs.xstocks.fi/docs/exchange-integration
- https://assets.backed.fi/legal-documentation/restricted-countries
- https://solana.com/docs/tokens/extensions/scaled-ui-amount
- https://ondo.finance/ondo-stocks
- https://docs.ondo.finance/api-reference/quickstart
- https://docs.ondo.finance/api-reference/assets/get-metadata-for-all-supported-assets
- https://www.superstate.com/opening-bell
- https://www.superstate.com/assets
- https://docs.dinari.com/docs/quickstart

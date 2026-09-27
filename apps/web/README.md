# Flay

Flay is a self-custodial Solana trading app for a hackathon release. Convert compares live Jupiter, Raydium, and Orca swap routes and uses Jupiter Trigger for limit orders. Stocks discovers canonical Solana xStocks through the official public API and executes market buys or sells only through Jupiter Swap V2. Eligible Jupiter market swaps use Jupiter-managed sponsorship; eligible Raydium and Orca SPL-to-SPL market swaps use Privy's managed sponsor. Funds includes Privy Card Onramps for direct Solana USDC delivery and a Privy-sponsored mainnet USDC send to recipients with an existing USDC account. Futures compares native Phoenix and GMTrade perpetual venues for isolated, direct-USDC positions. Privy provides the exportable wallet and signs every setup or trade. Flay deploys no custom program and charges no application fee.

The Stocks scope is [`HACKATHON_XSTOCKS_PLAN.md`](../../HACKATHON_XSTOCKS_PLAN.md), with its wallet-bound execution fix in [`XSTOCKS_EXECUTABLE_ROUTE_FIX_PLAN.md`](../../XSTOCKS_EXECUTABLE_ROUTE_FIX_PLAN.md). The active fiat scope is [`HACKATHON_PRIVY_FIAT_ONRAMP_PLAN.md`](../../HACKATHON_PRIVY_FIAT_ONRAMP_PLAN.md). The active gasless scopes are [`HACKATHON_GASLESS_USDC_SEND_PLAN.md`](../../HACKATHON_GASLESS_USDC_SEND_PLAN.md) and [`HACKATHON_RAYDIUM_ORCA_GASLESS_PLAN.md`](../../HACKATHON_RAYDIUM_ORCA_GASLESS_PLAN.md), with current evidence in [`RAYDIUM_ORCA_GASLESS_COMPLETION_AUDIT.md`](../../RAYDIUM_ORCA_GASLESS_COMPLETION_AUDIT.md). The exact user-paid setup affordability addendum and evidence are in [`HACKATHON_EXACT_SOL_AFFORDABILITY_FIX_PLAN.md`](../../HACKATHON_EXACT_SOL_AFFORDABILITY_FIX_PLAN.md) and [`EXACT_SOL_AFFORDABILITY_FIX_AUDIT.md`](../../EXACT_SOL_AFFORDABILITY_FIX_AUDIT.md). The completed Jupiter sponsorship scope remains in [`HACKATHON_MINIMUM_GASLESS_PLAN.md`](../../HACKATHON_MINIMUM_GASLESS_PLAN.md). Alchemy Pay is paused at its saved credential checkpoint and retained only as dormant fallback history.

## Local setup

Use Node 20 or newer and a Rust 1.85-or-newer toolchain. Build the pinned GMTrade sidecar first:

```sh
cd services/gmtrade-adapter
cargo build --release --locked
cd ../../apps/web
npm ci
cp .env.example .env
npm run dev
```

Run the first command from the repository root before changing to `apps/web`; the final three commands run from `apps/web`. Open `http://localhost:5173`.

Fill the three Privy values in `.env` to enable signing. In Privy, add the local/deployed origin, enable Google or email login, Solana embedded wallets, user-owned wallet export, identity tokens, and Card onramps. Keep `PRIVY_APP_ID` equal to `VITE_PRIVY_APP_ID`. Never expose `PRIVY_VERIFICATION_KEY`, provider keys, or a private RPC URL through a `VITE_` variable. The browser app ID and `VITE_PRIVY_ONRAMP_ENV` are intentionally public.

Use a mainnet RPC that supports transaction simulation, token accounts, address lookup tables, and history. The public Solana endpoint is suitable only for light exploration. The default GMTrade binary path is `services/gmtrade-adapter/target/release/flay-gmtrade-adapter`; `GMTRADE_ADAPTER_BIN` can select another reviewed build.

## xStocks through Jupiter

Stocks reads the official public xStocks catalog from `https://api.xstocks.fi/api/v2`, requests the documented Solana catalog scope, retains only valid Solana deployments, and needs no xStocks API key. Optional `XSTOCKS_*` environment values tune request and cache timing; `XSTOCKS_CATALOG_TIMEOUT_MS` defaults to 45 seconds for one bounded background directory attempt, `XSTOCKS_DETAIL_TIMEOUT_MS` defaults to six seconds for issuer detail checks, and `XSTOCKS_REFERENCE_TIMEOUT_MS` and `XSTOCKS_ONCHAIN_TIMEOUT_MS` default to 3.5 seconds for optional issuer reference data and the display-only on-chain verification attempt. Execution remains disabled until its canonical Token-2022 mint check succeeds. The browser selects an issuer symbol; the server derives and rechecks the canonical mint, so a browser-supplied arbitrary mint cannot enter this path.

Asset reference prices and trading status come from xStocks and are labeled separately from executable Jupiter data. Market buys use exact-input native Solana USDC; market sells use the official xStock mint and return USDC. Stocks uses the wallet-bound Jupiter Swap V2 Metis Router with a 32-account cap so small orders prefer a compact direct path instead of an unbuildable multi-hop path or the Meta-Aggregator's gasless minimum. Flay assembles and simulates the exact v0 transaction before showing `LIVE`; the user's wallet pays the disclosed network fee and any token-account rent. The route then enters the existing expiring structural validation, second simulation, signing, and RPC execution boundary.

Solana xStocks use Token-2022 Scaled UI Amount. Jupiter and Solana transactions carry raw atomic values, while Flay displays `raw token units × current multiplier` as shares. The server performs buy output, sell input, holding, review, and Activity conversion with decimal-string `BigInt` arithmetic and stores the multiplier snapshot with the quote. Convert continues to reject these extensions outside the official stock allowlist.

xStocks are tokenized securities. Availability depends on the user's jurisdiction and the issuer's current restrictions. Flay does not provide brokerage, issuance/redemption, dividends, shareholder rights, guaranteed liquidity, or universal access. A VPN does not change eligibility.

## Minimum gasless Convert path

Flay requests Jupiter `/swap/v2/order` with the authenticated wallet as `taker` and does not send an integrator `payer` or referral fee. No extra gasless secret or environment variable is required. When Jupiter returns `gasless: true` with a valid `signatureFeePayer` different from the taker, the server verifies that address against the transaction fee payer and allows only that exact provider signer to remain unsigned. Privy signs the unchanged message as the taker, Flay verifies the Ed25519 signature, and Jupiter `/execute` adds the provider signature and submits the transaction.

The principal balance check runs before preparation without imposing Flay's general 0.005 SOL safety reserve on Jupiter, because the prepared order determines whether a provider pays gas. If the prepared Jupiter order is user-paid, the exact freshly built transaction must prove affordability in Solana simulation before review; the review shows its simulated total wallet SOL debit, including account rent. JupiterZ transactions may invoke Jupiter's official Order Engine program; Flay allows that fixed deployment only when the provider response identifies the route as JupiterZ.

Eligibility is dynamic. Jupiter commonly sponsors a low-SOL wallet only above its current minimum trade value, and JupiterZ routes may use their market maker as fee payer. Flay checks every prepared order and labels it `Sponsored by Jupiter` only after validation. A non-sponsored Jupiter order remains user-paid. Raydium and Orca use the separate bounded Privy path below. Limit orders, Futures actions, MagicBlock actions, fiat actions, and routes outside either sponsorship boundary remain user-paid.

The reviewed output already reflects Jupiter's fees, including any amount Jupiter uses to recover automatic sponsorship cost. Flay sends no referral parameters and charges 0%. If Jupiter returns its gasless-minimum error, increase the swap amount or fund enough SOL for a user-paid transaction. Do not add a `payer` parameter without a separate funded-sponsor design and abuse controls.

For live acceptance, use the founder-controlled Privy wallet with less than 0.01 SOL and enough input token for an eligible swap near or above Jupiter's current dynamic minimum. Capture the prepared order's gasless flag and non-user fee payer from safe server diagnostics, approve the review that says `Sponsored by Jupiter`, then record the confirmed Explorer transaction and verify that its fee payer matches the prepared payer. Do not record identity tokens, signed transaction bytes, or wallet secrets.

## Privy-sponsored Raydium and Orca Convert

Flay considers Privy sponsorship only after Raydium or Orca returns a fresh, single market-swap transaction. Both assets must be SPL tokens, both canonical wallet token accounts must already exist, and the reviewed transaction may contain no account creation, account close, native-SOL synchronization, direct system transfer, rent movement, unknown signer, or unreviewed program. Native SOL routes and missing token accounts remain visibly user-paid.

For an eligible review, the browser sends only the server-produced transaction through Privy's React `useSignAndSendTransaction` hook with `sponsor: true`, simulation enabled, and non-optimistic broadcast. The normal Flay execution endpoint refuses this preparation. After broadcast, an authenticated completion endpoint fetches the confirmed Solana transaction and requires the same wallet, venue programs and pool, exact input debit, at least the reviewed minimum output, a non-user fee payer, and an unchanged wallet SOL balance. Retrying completion is idempotent; a conflicting signature is rejected.

Use the same Privy dashboard sponsorship setup listed under **Gasless USDC send**, including Solana mainnet client sponsorship, prepaid or approved postpaid billing, conservative account limits, and monitoring. No Privy secret or sponsor key is added to Flay. If a transaction is structurally ineligible, it remains user-paid and reaches review only when the exact transaction simulation proves that the wallet can pay its network fee and any account rent. Flay shows the simulated total instead of imposing the general fixed reserve on this already-built transaction.

For live acceptance, first ensure the founder-controlled embedded wallet already has both token accounts. With too little SOL to pay the fee, approve the smallest practical Raydium SPL-to-SPL conversion and then the smallest practical Orca SPL-to-SPL conversion. Save each public Explorer signature and verify the venue, token deltas, non-user fee payer, and zero wallet SOL delta. These two confirmed transactions are required before this block can be called complete.

## Gasless USDC send

The Funds page can send native mainnet USDC from the authenticated embedded wallet with Privy as the managed fee payer. The server fixes the mint, token program, and decimals; verifies the sender balance and both canonical associated token accounts; builds one `TransferChecked` instruction; rejects lookup tables and every extra instruction; and simulates the exact transaction before review. The browser submits only those server-produced bytes through Privy's React `useSignAndSendTransaction` hook with `sponsor: true`, visible approval, simulation enabled, and non-optimistic broadcast. There is no wallet-paid fallback.

The recipient must already have a canonical mainnet USDC associated token account. This first scope deliberately creates and closes no token account, so it does not expose sponsorship credits to associated-account rent or rent refunds. A recipient without an account sees an actionable error and no transaction is submitted.

Configure Privy before testing:

1. Use Privy's TEE wallet execution stack for the embedded Solana wallet.
2. In **Fee sponsorship**, add prepaid credits with the billing setup Privy requires, or enable approved postpaid billing.
3. Turn on **Sponsor gas fees** and enable **Solana mainnet** under supported chains.
4. Enable sponsorship for transactions initiated by the client SDK.
5. Set conservative total-spend and per-wallet limits in Privy, monitor failures and unusual volume, and keep Flay's `/api/transfers/usdc/prepare` rate limit in place.

No Privy app secret or sponsor key belongs in the browser or this repository. The public Privy app ID and existing identity-token configuration are sufficient for the React approval request after dashboard sponsorship is enabled. If Privy reports missing TEE execution, disabled sponsorship, or exhausted credits, Flay stops and explains which dashboard settings to check.

After submission, Flay polls its authenticated USDC-send status endpoint. A send becomes confirmed only when RPC proves the exact `TransferChecked` amount and canonical recipient account, an external fee payer, matching sender/recipient token deltas, and no sender lamport debit. Recent browser history stores only the public signature, recipient, amount, time, and status; it stores no identity token or serialized transaction.

For live acceptance, send the smallest practical USDC amount from the founder-controlled embedded wallet to a different wallet whose mainnet USDC account already exists. Save the public Explorer signature, confirm the recipient credit, verify that the transaction fee payer differs from the sender, and verify that the sender's SOL delta is zero. Never record identity tokens, raw transaction bytes, or wallet secrets.

## Privy Card Onramps

Set `VITE_PRIVY_ONRAMP_ENV=sandbox` during integration. In the Privy Dashboard, open **Funding** and enable **Card onramps** for the Flay app. If the Funding control is absent, use the direct dashboard route at `https://dashboard.privy.io/apps?page=funding` and contact Privy Developer Slack or `support@privy.io` to request Card Onramps / `useFiatOnramp` access for the app ID. No Privy secret is required in the browser for this flow.

Flay opens a dedicated same-origin checkout tab and resolves a provider path before opening Privy because Privy's quote modal can return only a failed Stripe quote outside Stripe's regions instead of moving to MoonPay. The browser makes one bounded request to `https://ipinfo.io/json`, retains only the selected route in session storage, and never stores or logs the returned IP. Sandbox, the United States except New York, the European Union, and Serbia use Privy's `useFiatOnramp` quote flow. Other or unknown regions use Privy's Solana `useFundWallet` card flow with MoonPay preferred. Flay still shows one automatic action and no provider selector.

Both paths bind the authenticated embedded wallet and Solana USDC. The quote path also fixes the native USDC mint and Solana mainnet CAIP-2 identifier; only a validated fiat currency, amount, and one-time request ID enter the checkout URL. The selected provider owns the final quote, fees, payment method, KYC, authorization, and delivery. Flay never receives card, bank, or KYC data and does not create a private order record. The legacy MoonPay flow does not return an authoritative submitted/confirmed status, so Flay labels its exit honestly and refreshes the Solana balance instead of claiming a purchase.

The separate tab is a recovery boundary for provider-owned SMS and KYC screens. If a provider remains pending or unresponsive, close only the checkout tab; Convert, Futures, and Funds stay usable in the original Flay tab. A real Privy `submitted` or `confirmed` result is sent back through a request-bound same-origin channel and triggers an authoritative USDC balance refresh. Returning focus also refreshes balance without claiming that a purchase succeeded.

The launch UI offers USD, EUR, AUD, and BRL. Broader coverage, including BDT, requires configuring Meld from Privy's Funding page and completing its KYB. Available currencies, payment methods, and countries remain provider-dependent. Stripe's embedded path requires `@stripe/crypto`, which is a pinned application dependency.

For a sandbox checkout, use an amount below USD 200, a US or EU-format test phone number, verification code `000000`, card `4242 4242 4242 4242`, any future expiry, and any three-digit CVC. Sandbox still requires the mainnet-format Solana CAIP-2 destination; it moves no real money. Switch to `VITE_PRIVY_ONRAMP_ENV=production` only after a reviewed sandbox result, production provider access, origin configuration, and regional checks. Production SMS, KYC, quotes, and payments are real. Use the purchaser's real residence and matching phone and identity information; a VPN does not change provider eligibility.

The paused Alchemy Pay server routes and order store remain in the repository as a fallback checkpoint. The shipped Funds page does not call them or show their merchant-credential blocker.

## Futures behavior

Flay reads public Phoenix markets and candles before onboarding, but never recommends or enables Phoenix execution until the connected wallet has the required onchain capabilities. Phoenix login for trading first uses the connected Privy embedded wallet identity when the venue recognizes it. Otherwise, Flay issues Phoenix's one-time wallet challenge, verifies the exact signed Memo instruction, and exchanges it for a venue session. Challenges stay only in server memory for at most five minutes; venue sessions stay there for at most ten minutes.

Phoenix onboarding uses the official public no-referral builder. The returned transaction registers portfolio 0 when needed and grants trading capabilities; Flay binds the exact wallet, trader PDA, max positions, programs, accounts, and Phoenix onboarding signer before Privy can sign. Phoenix adds its reviewed signer and submits through the official endpoint. USDC deposit has its own review and signature. A Phoenix route remains ineligible until live parent collateral covers the requested entry, and the ticket opens the required setup action before requesting a fresh quote. Each entry then uses a nonzero isolated child trader account with one allowed position. Flay reconstructs the native register-if-needed, parent sync, exact atomic-USDC parent-to-child collateral transfer, order, and collateral-cleanup bundle with the pinned Rise SDK, then validates every instruction and account before Privy can sign it.

GMTrade runs as a private JSON-Lines child process with no network listener. It uses `gmsol-sdk` 0.10.0 from reviewed source revision `7ce035b41a266cb5ddb0192e5d29deb0c7e67a72`, a non-signing wallet, direct USDC paths, and the pinned mainnet program deployment recorded in `services/gmtrade-adapter/src/main.rs`. It returns unsigned versioned transactions for the Privy wallet. A program hash or upgrade-slot change disables new GMTrade entries.

Every reviewed Futures action is bound to its wallet, venue, native market, current venue state, recent blockhash, allowed programs/tables/signers, and exact serialized message. Flay verifies the wallet signature and rejects changed messages. Existing cancel, reduce, close, and recovery controls remain visible if a data provider becomes degraded.

MagicBlock PER remains a separate protected USDC account. Flay verifies MagicBlock's mainnet TEE attestation, signs a real `/auth/challenge` through the connected Privy wallet, and keeps the resulting TEE bearer token only in server memory. The official Private Payments API continues to build and submit the reviewed USDC deposit, private-transfer, and withdrawal transactions. `MAGICBLOCK_TEE_BASE_URL` defaults to `https://mainnet-tee.magicblock.app`; `MAGICBLOCK_BASE_URL` defaults to `https://payments.magicblock.app`. MagicBlock cannot make Phoenix or GMTrade positions private because those venues settle publicly on Solana.

## Verification

From `apps/web`:

```sh
npm run check
LIVE_PROVIDER_TESTS=1 npm test -- server/live-providers.test.ts
LIVE_STOCKS_TESTS=1 npm test -- server/live-stocks.test.ts
LIVE_PROVIDER_TESTS=1 npm test -- server/live-magicblock.test.ts
LIVE_FUTURES_TESTS=1 npm test -- server/futures/live-futures.test.ts
npm audit --omit=dev
```

From `services/gmtrade-adapter`:

```sh
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo build --release --locked
cargo audit
```

The Futures live suite checks both public registries, all six Phoenix candle intervals, authoritative GMTrade state, real GMTrade and Phoenix public-onboarding unsigned builds, transaction structure, and mainnet simulations that must finish without a program error. Its default funded public wallet is used only as read-only `sigVerify:false` simulation state; set `GMTRADE_TEST_WALLET` to another public address with at least 1 USDC in its canonical account and 0.01 SOL when needed. No transaction is signed or submitted.

Final release acceptance also requires the founder-controlled, signed mainnet flows and Explorer evidence listed in the active plan. Keep the total founder-funded test capital at or below USD 10. Stop and record a blocker if venue minimums or rent would exceed it.

## Deployment

Build the locked Rust sidecar and run `npm ci && npm run build`, then start the Express server with `npm start`. Route `/api/*` and the SPA through the same HTTPS origin. Register that origin in Privy. Use one server instance for this release because prepared messages, Phoenix sessions, and idempotency records are held in bounded memory; a restart safely invalidates pending reviews. Store RPC and Privy verification secrets in the host secret manager and disable request-body logging. If the dormant Alchemy fallback is ever reactivated, its credentials and order-store directory require a separate production review.

# Flay build rules

These rules apply to every Flay implementation session.

## Completed Alchemy Solana RPC production configuration

`ALCHEMY_RPC_CONFIGURATION_PLAN.md` is the active configuration plan. Its full text is embedded here.

# Flay Alchemy Solana RPC production configuration

**Status:** complete — see `ALCHEMY_RPC_CONFIGURATION_AUDIT.md`
**Date:** 2026-09-27
**Scope:** replace the rate-limited public Solana RPC used by local and Railway production runtimes with the founder-provided Alchemy endpoint

## Observed fault

The production Convert UI reports `429 Too Many Requests` and `Connection rate limits exceeded` while reading the authenticated wallet balance. The deployed health response confirms that Flay is using `api.mainnet-beta.solana.com`, so balance reads, simulations, account discovery, and provider adapters share a heavily rate-limited public endpoint.

The screenshots also contain an account-rent shortage and a Jupiter quote failure. The rent shortage is a real wallet-funding condition and must remain visible. The Jupiter failure may recover once RPC-dependent preparation is stable, but Flay must not misrepresent it if Jupiter itself has no route.

## Implementation plan

1. Validate the founder-provided Alchemy key against Alchemy's Solana mainnet JSON-RPC endpoint without printing or committing the key.
2. Update the ignored local `SOLANA_RPC_URL` value and the Railway production `SOLANA_RPC_URL` variable. Keep Railway's injected port and every unrelated production variable unchanged.
3. Let Railway restart the service with the new runtime variable, then verify that the final deployment succeeds and binds normally.
4. Confirm through the sanitized health response that Flay is using the Alchemy Solana host and that RPC blockhash and transaction-simulation probes pass.
5. Exercise repeated wallet-balance JSON-RPC calls plus the public Convert, Futures, Stocks, and health endpoints, and inspect final logs for RPC 429, crash, or HTTP 5xx records.
6. Run repository safety checks proving that the Alchemy key and complete endpoint are absent from tracked files and staged changes.
7. Compare every criterion with the final runtime state and record `ALCHEMY_RPC_CONFIGURATION_AUDIT.md` before declaring the migration complete.

## Acceptance criteria

1. The Alchemy Solana mainnet endpoint accepts a JSON-RPC health or blockhash request using the supplied key.
2. Local ignored configuration and Railway production use the Alchemy endpoint; the key is absent from tracked files, plans, audits, logs, and final reporting.
3. The replacement Railway deployment reaches `SUCCESS`, the root application and `/api/health` return HTTP 200, and health reports the Alchemy RPC host.
4. RPC readiness and simulation readiness are available, and repeated wallet-balance calls complete without HTTP 429.
5. Convert discovery, Futures markets, and Stocks directory endpoints respond without a server crash.
6. The genuine account-rent warning remains enforced when a transaction requires more SOL; no balance, quote, or transaction result is fabricated.
7. Final logs contain no RPC 429 or HTTP 5xx record from the verified deployment, repository safety checks pass, and the completion audit maps every criterion to evidence.

## Completion rule

Do not mark this migration complete until `ALCHEMY_RPC_CONFIGURATION_AUDIT.md` maps every acceptance criterion to final configuration and live Railway evidence.

## Completed Railway production deployment

`RAILWAY_DEPLOYMENT_PLAN.md` is the active deployment plan. Its full text is embedded here.

# Flay Railway production deployment

**Status:** complete — see `RAILWAY_DEPLOYMENT_AUDIT.md`
**Date:** 2026-09-27
**Scope:** deploy the current Flay web application and GMTrade sidecar as one reproducible Railway service

## Goal

Publish the current private GitHub repository to a public Railway HTTPS endpoint without exposing local credentials. The production image must serve the Vite application, Express API, and the Rust GMTrade adapter required by Futures.

## Implementation plan

1. Add a multi-stage Docker build that compiles the pinned GMTrade Rust adapter, installs the locked Node dependencies, builds the Vite client, and produces one production runtime image.
2. Keep the runtime on a non-root user, bind Express to Railway's injected `PORT` on `0.0.0.0`, include only production dependencies and compiled/browser/runtime source, and provide a container health check.
3. Add Railway infrastructure configuration for the root Dockerfile, the public health endpoint, bounded startup time, one replica, and restart-on-failure behavior.
4. Add a Docker build-context exclusion file so local `.env` files, Git data, dependency trees, build outputs, logs, PIDs, tests, and local artifacts are never uploaded into the image context.
5. Create and link a Railway project and service under the authenticated founder account. Copy only the allowlisted required values from the ignored local environment into Railway, without printing their contents, and let Railway provide its own `PORT`.
6. Deploy the exact working tree, generate a Railway public domain, and verify the deployment status, root application shell, readiness endpoint, and representative public-data endpoints over HTTPS.
7. Inspect build and runtime logs for secret leakage, crash loops, missing binaries, provider initialization failures, and health-check failures. Correct any deployment issue and redeploy until the service is stable.
8. Run the repository's relevant checks and production build, compare every criterion with the final files and live deployment, record a completion audit, then commit and push the deployment configuration to `main`.

## Acceptance criteria

1. Railway builds the Node application and locked Rust GMTrade adapter from the repository without depending on local `node_modules`, `target`, or untracked files.
2. The runtime starts with Railway's injected port, runs as a non-root user, serves the production SPA and API, and can execute the packaged GMTrade adapter at its configured path.
3. No `.env`, credential value, private key, wallet signature, transaction body, or provider token is committed, embedded in the image, or exposed in command/report output.
4. The production service has exactly one replica and a bounded health check and restart policy suitable for Flay's in-memory prepared-intent state.
5. A Railway-provided HTTPS domain returns the Flay shell and a healthy readiness response; representative Convert, Futures, and Stocks public-data requests respond without a server crash.
6. The deployment logs show a stable running service and no missing-build-artifact, missing-sidecar, port-binding, or health-check failure.
7. Relevant tests, TypeScript checks, production build, deployment smoke tests, repository status checks, and the final plan-to-code audit pass before completion is declared.

## Completion rule

Do not mark this deployment complete until `RAILWAY_DEPLOYMENT_AUDIT.md` maps every acceptance criterion to final repository files and live Railway evidence.

## Active Convert automatic preparation fallback

`CONVERT_AUTO_PREPARE_FALLBACK_FIX_PLAN.md` is the active correction plan. Its full text is embedded here.

# Flay Convert automatic preparation fallback

**Status:** active  
**Date:** 2026-09-27  
**Scope:** make Auto select the best route that can produce an exact reviewed transaction

## Observed fault

The founder's `oyur.jpg` shows three fresh SOL-to-USDC quotes. Auto selects Jupiter at `0.143482 USDC`, but pressing Review returns `Jupiter: Failed to get quotes` even though current Raydium and Orca alternatives remain visible. Quote ranking works, but exact preparation stops after the first venue fails. Native-SOL direct routes are also rejected by a generic 0.005 SOL reserve before Flay can build and simulate their exact fee requirements.

## Implementation plan

1. Build a deterministic preparation candidate list from the current response: Auto uses ranked live quotes once each; a manual venue uses only the selected quote.
2. During Auto preparation, try the next current candidate only when the previous API failure is explicitly retryable or is an explicit venue-local route/build unavailability. Stop immediately for wallet, identity, validation, balance, or transaction-safety errors.
3. Preserve the actual prepared provider, exact transaction, output, minimum, fees, gas mode, warnings, wallet binding, and review screen returned by the successful fallback. Never combine values between venues or fabricate a route.
4. Keep manual Jupiter, Raydium, or Orca selection fixed to that venue and surface its real failure without fallback.
5. For market preparation, precheck the exact input principal with zero speculative SOL reserve for every venue. Continue to require the freshly built transaction to pass structural validation and exact Solana simulation, which determines its real network fee and rent affordability before signing.
6. If every eligible Auto candidate has a retryable failure, show one bounded error identifying the attempted venues and their user-safe messages.
7. Add focused tests for ranked Auto candidates, manual-route isolation, duplicate prevention, retryable and venue-local fallback eligibility, bounded combined errors, and the exact-simulation affordability boundary.
8. Validate the founder wallet's reported small SOL-to-USDC path against live providers without signing, then run focused and full tests, production build, release audit, browser audit, local health, and a changed-path marker scan.
9. Compare every item and acceptance criterion with final code in a completion audit before declaring completion.

## Acceptance criteria

1. With live Jupiter, Raydium, and Orca quotes, Auto tries them in ranked response order and stops on the first exact preparation success.
2. A retryable Jupiter failure or explicit `Failed to get quotes` venue rejection can reach a valid Raydium or Orca review instead of ending at the global error banner.
3. Manual venue selection never switches providers automatically.
4. Identity, wallet, input-balance, exact SOL/rent, and transaction-validation errors never trigger another venue attempt.
5. Native SOL principal is prechecked without the old fixed 0.005 SOL buffer, while exact transaction simulation remains mandatory and rejects a real fee or rent shortfall before signing.
6. The review and eventual execution remain bound to one successful provider transaction and the authenticated wallet.
7. All-route failure reporting is bounded, actionable, and contains no raw provider payload or secret data.
8. Focused tests, full tests, build, release scan, browser audit, live provider evidence, local health, marker scan, and completion audit pass.

## Completion rule

Do not mark this correction complete until `CONVERT_AUTO_PREPARE_FALLBACK_FIX_AUDIT.md` maps every criterion to final code and verification evidence.

## Active local Phoenix startup stability correction

`LOCAL_PHOENIX_STARTUP_STABILITY_PLAN.md` is the active correction plan. Its full text is embedded here.

# Flay local Phoenix startup stability

**Status:** complete — see `LOCAL_PHOENIX_STARTUP_STABILITY_AUDIT.md`  
**Date:** 2026-09-27  
**Scope:** keep the supervised local app online when the Phoenix SDK abandons a background HTTP startup request

## Observed fault

Starting Flay locally reaches `http://127.0.0.1:5173`, but the Phoenix SDK later raises an orphaned rejection for an aborted `https://perp-api.phoenix.trade` request. The request is a recoverable provider-connectivity failure, yet the global process-safety handler currently treats every non-RPC background rejection as fatal. The supervisor restarts the server, causing repeated local outages.

## Implementation plan

1. Recognize only an aborted Phoenix HTTP API connection failure whose message names the official Phoenix API origin and the aborted operation.
2. Contain that orphaned provider rejection in the process-safety handler while preserving fatal behavior for arbitrary aborts, other domains, provider validation failures, and unknown unhandled errors.
3. Add focused positive and negative tests for the classification boundary.
4. Run focused and full tests, production build, release audit, restart the supervised server, and verify both the app shell and health endpoint remain available.
5. Compare this plan with the final code and record a completion audit before declaring the correction complete.

## Acceptance criteria

1. The exact Phoenix background connection-abort seen in the local log no longer terminates the Node process.
2. An unrelated `AbortError`, an error from a different domain, and unknown failures remain fatal.
3. The supervised local server survives the Phoenix failure window and responds at `http://127.0.0.1:5173`.
4. Focused tests, full tests, production build, release audit, health verification, and the completion audit pass.

## Completion rule

Do not mark this correction complete until `LOCAL_PHOENIX_STARTUP_STABILITY_AUDIT.md` maps every criterion to final code and verification evidence.

## Active xStocks sell-balance and compact-route correction

`XSTOCKS_SELL_BALANCE_COMPACT_ROUTE_FIX_PLAN.md` is the active correction plan. Its full text is embedded here.

# Flay xStocks sell-balance and compact-route correction

**Status:** complete — see `XSTOCKS_SELL_BALANCE_COMPACT_ROUTE_FIX_AUDIT.md`  
**Date:** 2026-09-27  
**Scope:** reject impossible stock sell inputs locally and recover from rent-heavy Jupiter stock routes

## Observed fault

The Stocks sell ticket defaults to `0.01` shares even when the confirmed holding is smaller. In the founder screenshot, the input is `0.01 AAPLx` while the confirmed display balance is only `0.00038246 AAPLx`. Flay still asks Jupiter to build the impossible trade, and the first two-hop route fails earlier while creating a rent-bearing account, producing a confusing `0.000333453 SOL more for account rent` message.

The wallet currently has `0.001163493 SOL` and `38121` raw AAPLx units. A live Jupiter request with the existing 32-account cap selected a two-hop route with two setup instructions and failed simulation for rent. A second request capped at 20 accounts selected a direct Raydium CLMM route with one setup instruction; that exact transaction simulated successfully with the wallet's current balances.

## Implementation plan

1. Convert the entered scaled stock display amount to raw units in the browser and compare it with the confirmed canonical stock-token balance before requesting a route.
2. When Sell is selected, initialize the ticket with the available scaled stock balance instead of the unrelated fixed `0.01` amount.
3. Keep review disabled and show the existing confirmed-balance error whenever the entered sell amount exceeds the holding; do not call Jupiter until the input becomes affordable.
4. Keep Jupiter's 32-account route as the first choice. If and only if exact simulation reports `INSUFFICIENT_SOL` for account rent, request one bounded compact fallback with `maxAccounts=20` and simulate it.
5. Return and later prepare the exact compact transaction and quote when it succeeds. Do not retry for insufficient token balance, malformed provider data, slippage, arbitrary simulation failures, preparation, signing, or execution.
6. Add focused tests for scaled client-side balance comparison, sell-tab amount initialization, compact-fallback eligibility, and preserved route request bounds.
7. Verify the founder wallet's full AAPLx holding against live Jupiter, run focused and full tests, TypeScript/production build, release audit, browser audit, and local health, then write a plan-to-code completion audit.

## Acceptance criteria

1. An entered `0.01 AAPLx` is recognized as greater than the confirmed `38121` raw-unit holding and cannot issue a stock quote or enable review.
2. Selecting Sell fills the ticket with the current scaled AAPLx balance when balances are available.
3. The normal Router request still uses `maxAccounts=32`; only an `INSUFFICIENT_SOL` assembly result can cause one `maxAccounts=20` fallback request.
4. Other provider, validation, balance, or simulation failures remain fail-closed and are not retried as compact routes.
5. The founder wallet's full AAPLx balance produces a live, simulated, direct executable route using its current SOL balance.
6. The final quote, minimum output, route label, transaction bytes, wallet binding, and later review all come from the same successful compact Jupiter build. No quote or transaction is fabricated.
7. Focused tests, full checks, release scan, browser audit, local health, live mainnet evidence, and the completion audit pass before completion is declared.

## Completion rule

Do not mark this correction complete until `XSTOCKS_SELL_BALANCE_COMPACT_ROUTE_FIX_AUDIT.md` maps every acceptance criterion to final code and verification evidence.

## Active xStocks sell-quote recovery

`XSTOCKS_SELL_QUOTE_RECOVERY_PLAN.md` is the active correction plan. Its full text is embedded here.

# Flay xStocks sell-quote recovery

**Status:** complete — see `XSTOCKS_SELL_QUOTE_RECOVERY_AUDIT.md`  
**Date:** 2026-09-27  
**Scope:** restore executable Jupiter proceeds for valid xStocks sales and make provider failures recoverable

## Observed fault

The Stocks ticket accepts a valid stock amount but can remain on `WAITING`, show no estimated USDC proceeds, and tell the user to enter an amount. For the founder's exact report, `0.000091 NVDAx`, the scaled amount is `9084` raw units and Jupiter currently builds and simulates an executable route returning about `0.020427 USDC`. The route is therefore being hidden by Flay's empty-provider-response path rather than rejected for dust or missing liquidity.

## Implementation plan

1. Preserve the existing canonical xStocks mint, scaled-UI conversion, wallet binding, Token-2022 validation, Jupiter-only execution, and exact transaction simulation.
2. Do not cache a quote aggregation result when every requested provider failed. A temporary Jupiter or RPC failure must be eligible for a fresh provider attempt rather than replayed from the quote cache.
3. For a stock quote only, retry one time after a short bounded delay when the sole Jupiter failure is marked retryable. Do not retry validation failures, non-retryable failures, transaction preparation, signatures, or execution.
4. If no executable stock route exists after the bounded retry, return the real provider failure as an API error. Never turn a provider failure into a successful response with empty proceeds.
5. In the Stocks ticket, show the returned route error and an explicit `Retry route` action. Keep the review action disabled until a current executable quote exists.
6. Add regression coverage for failed-response cache behavior, one-time stock recovery, terminal error propagation, and the visible retry action.
7. Verify the exact founder NVDAx sale through the real service, run focused and full tests, TypeScript/production build, release audit, browser audit, and local health. Then compare every criterion with final code in a completion audit.

## Acceptance criteria

1. `0.000091 NVDAx` converts to the canonical `9084` raw input and a live service request returns executable USDC proceeds when Jupiter is healthy.
2. An all-provider failure is not stored in the quote cache, while successful quote caching remains unchanged.
3. A retryable first Jupiter failure receives exactly one fresh stock-quote retry and can recover to an executable response.
4. A second retryable failure, or any non-retryable failure, reaches the browser with its real provider message; Flay does not show an empty successful quote or misleading amount prompt.
5. The Stocks UI exposes `Retry route`, refreshes through the existing bounded quote path, and cannot enable review without a live unexpired route and sufficient confirmed balance.
6. No fake price, route, balance, or transaction is introduced; wallet binding and the reviewed Jupiter transaction trust boundary remain intact.
7. Focused tests, the full check, release scan, browser audit, exact live NVDAx service evidence, local health, and the final plan-to-code audit pass before completion is declared.

## Completion rule

Do not mark this correction complete until `XSTOCKS_SELL_QUOTE_RECOVERY_AUDIT.md` maps every acceptance criterion to final code and verification evidence.

## Active GMTrade timeout correction

`GMTRADE_ADAPTER_TIMEOUT_FIX_PLAN.md` is the active correction plan. Its full text is embedded here.

# Flay GMTrade adapter timeout correction

**Status:** complete — see `GMTRADE_ADAPTER_TIMEOUT_FIX_AUDIT.md`  
**Date:** 2026-09-27  
**Scope:** stop valid GMTrade portfolio reads from killing the local sidecar and showing a false recovery warning

## Observed fault

The Futures UI reports that GMTrade is temporarily unavailable while recovering. The live health probe subsequently reports GMTrade ready with its entry circuit closed. A direct mainnet portfolio read for the founder wallet succeeds in about 7.7 seconds, and a cold `health` + `markets` + `portfolio` sequence succeeds in about 11.8 seconds. The runtime code defaults to a five-second sidecar timeout, while `.env.example` documents 15 seconds. Because the Rust sidecar handles its input sequentially, the five-second default can terminate a healthy read and cascade a temporary recovery error to nearby requests.

## Implementation

1. Align the runtime default with the documented bounded 15-second GMTrade adapter timeout while retaining the existing 100 ms minimum and 30-second maximum environment override.
2. Preserve fail-closed behavior: a real timeout still terminates the stalled child, rejects affected reads, exposes cached positions and recovery controls, and waits for the bounded restart cooldown.
3. Do not automatically retry `prepare_action` or any transaction-building request; no transaction request may be duplicated during recovery.
4. Add focused coverage for the corrected default and retain the existing timeout, crash, cooldown, and restart tests.
5. Restart the supervised local server so the new default is active, then verify direct mainnet portfolio latency, GMTrade readiness, the full test/build checks, release audit, and browser audit.
6. Before claiming completion, compare every criterion with the final code and write `GMTRADE_ADAPTER_TIMEOUT_FIX_AUDIT.md`.

## Acceptance criteria

1. With no `GMTRADE_ADAPTER_TIMEOUT_MS` override, the adapter uses the documented 15-second bound rather than five seconds.
2. The founder-wallet portfolio probe that previously exceeded five seconds completes within the new bound without entering the recovery state.
3. Explicit short-timeout tests still terminate an unresponsive child and enforce the restart cooldown; transaction building remains non-retried.
4. Local health reports GMTrade public data and execution ready with the GMTrade entry circuit closed after restart.
5. Focused tests, full checks, release scan, browser audit, and the final plan-to-code audit pass.

## Active xStocks price-batch plan

`XSTOCKS_PRICE_BATCH_EXPANSION_PLAN.md` is the active plan. The full plan is embedded here because every implementation plan must be saved in a Markdown file and recorded in this file.

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

## Active scope

1. Alchemy Pay fiat on-ramp work is paused while waiting for sandbox credentials and commercial terms. Preserve the exact checkpoint in `ALCHEMY_PAY_WAITING_STATUS.md`. When resumed, treat `HACKATHON_ALCHEMY_PAY_PLAN.md` as the binding plan; its full text must remain embedded in `agent.md`.
2. Jupiter Convert sponsorship is implemented under `HACKATHON_MINIMUM_GASLESS_PLAN.md`. Gasless USDC send is implemented under `HACKATHON_GASLESS_USDC_SEND_PLAN.md`. Privy-sponsored Raydium and Orca Convert is the active gasless block under `HACKATHON_RAYDIUM_ORCA_GASLESS_PLAN.md`; all three plans must remain embedded in `agent.md`.
3. The broad platform gasless plan in `HACKATHON_GASLESS_PLAN.md` is preserved for later and remains superseded. Do not add a Flay sponsor wallet, Kora, sponsor key, or gasless support to Futures, MagicBlock, Trigger, fiat, native-SOL wrapping, missing token accounts, or arbitrary transfers. Raydium and Orca sponsorship is limited to the exact eligibility boundary in the active plan.
4. Preserve the Convert, Futures, Alchemy Pay, and Gasless plans and completion audits as truthful records, including founder-signed checks that remain open.
5. Do not begin memes, xStocks, off-ramp, or later product blocks early.
6. Flay must deploy no custom Solana program for the hackathon release.
7. Live functionality must never fall back silently to illustrative quotes, fake balances, fake activity, fake transactions, fake candles, fake positions, simulated orders, or fake fiat status.

## Hard completion rule

Before using the words `100% complete`, `fully complete`, `done`, or any equivalent claim:

1. Re-read the complete active plan.
2. Compare every planned requirement and every numbered acceptance criterion against the actual repository code.
3. Write a completion audit that maps each criterion to its implementation files and verification evidence.
4. Run all relevant builds, type checks, tests, security checks, and the required live mainnet small-value flows.
5. Search the shipped path for placeholders, mock data, disabled actions, unhandled TODO/FIXME markers, and preview-only behavior.
6. Verify that configuration and deployment documentation is sufficient for a fresh setup without exposing secrets.
7. Mark the build complete only if every item passes. Any missing, mocked, untested, inaccessible, credential-blocked, access-gated, or unfunded item means the build is incomplete and must be reported as such.

Continue implementing and verifying all work that can be completed autonomously before reporting a blocker. Never lower the plan's requirements merely to permit a completion claim. Never stop at a visually finished interface when live execution, recovery, security, or evidence remains unfinished.

## Safety boundary

- Users sign their own Solana transactions through the embedded wallet.
- Flay servers never receive or store user private keys.
- The minimum gasless block uses only Jupiter-managed sponsorship; Flay must not create, request, store, return, or log sponsor private signing material.
- Gasless USDC send uses Privy's managed fee payer through the user-approved React SDK flow; Flay must not create, request, store, return, or log Privy sponsor signing material.
- Accept sponsorship only for the exact reviewed Jupiter transaction after verifying the declared fee payer, required signers, unchanged message, and authenticated wallet signature.
- Alchemy Pay secrets remain server-side. Flay must never collect or store card data, bank credentials, or KYC documents.
- Bind every fiat checkout to the authenticated embedded wallet and verify signed callbacks before changing order state.
- Validate provider-built transactions against the reviewed intent before requesting a signature.
- Keep provider secrets, auth tokens, signed transactions, and request bodies out of logs.
- Preserve cancellation, reduction, close, and collateral recovery access whenever a trading provider is degraded.
- Phoenix public data may ship before onboarding, but Phoenix execution must remain ineligible until real wallet onboarding capabilities are confirmed.
# Flay Alchemy Pay fiat on-ramp implementation plan

Status: active implementation plan

This plan adds fiat deposits through Alchemy Pay's hosted On-Ramp checkout. Alchemy Pay documents this product as Ramp/On-Ramp rather than P2P. The hosted page keeps payment credentials and KYC outside Flay while delivering USDC directly to the user's Privy Solana wallet.

## 1. Product behavior

A signed-in user opens `Add funds`, selects fiat and an amount, reviews the immutable destination, then continues to Alchemy Pay in a new tab. The checkout is restricted to USDC on Solana and the authenticated embedded wallet. Flay tracks provider status separately from actual onchain receipt.

## 2. Included scope

1. Server-signed Alchemy Pay Page Integration checkout URLs.
2. USDC on Solana only (`crypto=USDC`, `network=SOL`).
3. Exact Privy identity-to-wallet binding.
4. Allowlisted fiat currencies and exact decimal limits.
5. Unique, persisted merchant orders.
6. Constant-time webhook signature verification and idempotent updates.
7. Authenticated order history and status refresh.
8. RPC verification of the final USDC delivery transaction.
9. Strict test/production separation.
10. Responsive Add Funds UI and wallet entry points.

The first release excludes native card forms, off-ramp, arbitrary assets/networks/addresses, custody, internal fiat balances, and any fake quote or payment state.

## 3. Checkout lifecycle

1. Verify the Privy identity token and requested embedded wallet.
2. Validate currency and amount using exact decimal parsing.
3. Persist a unique merchant order before returning a URL.
4. Server chooses asset, network, destination, callback, redirect, environment, and merchant name.
5. Sort non-empty parameters lexicographically and HMAC-SHA256 sign the documented `/index/rampPageBuy` path with the server-only secret.
6. Return only the signed checkout URL and safe review metadata.
7. Open checkout with `noopener,noreferrer`; keep Flay available with a pending order card.
8. Verify signed callbacks and apply monotonic state transitions.
9. Treat provider payment success separately from token delivery.
10. Verify the reported Solana transaction credits USDC to the bound wallet before showing `Funds received`.

## 4. States

- `created`: checkout issued.
- `payment-pending`: payment is in progress or accepted.
- `provider-failed`: payment failed.
- `provider-finished`: provider reports crypto delivery and a transaction hash.
- `confirmed`: RPC verifies USDC receipt to the reviewed wallet.
- `expired`: checkout expired.
- `review-required`: callback or onchain evidence conflicts with the reviewed order.

Terminal success cannot regress. Duplicate and out-of-order callbacks must remain idempotent.

## 5. Security

1. App secret stays server-side and never appears in browser bundles, API responses, logs, or errors.
2. Client cannot choose destination, asset, network, callback, redirect, order number, environment, or merchant name.
3. Callback verification checks timestamp age, app ID, signature, known order, wallet, asset, network, fiat, and amount.
4. Webhook canonical JSON excludes empty values, `signature`, and `newSignature`, then sorts keys exactly as documented.
5. Persist only required order metadata; discard webhook email, payment fields, and KYC data.
6. Checkout creation is rate-limited and bound to identity, wallet, and IP.
7. URL hosts are fixed to official Alchemy Pay test or production domains.
8. Order writes are atomic and durable for a single server instance.
9. Test mode is visually explicit and cannot be confused with production.

## 6. Configuration

- `ALCHEMY_PAY_ENV=test|production`
- `ALCHEMY_PAY_APP_ID`
- `ALCHEMY_PAY_APP_SECRET`
- `ALCHEMY_PAY_PUBLIC_URL`
- `ALCHEMY_PAY_ORDER_STORE_PATH`
- `ALCHEMY_PAY_ALLOWED_FIAT=USD,EUR,GBP`
- `ALCHEMY_PAY_MIN_FIAT_AMOUNT`
- `ALCHEMY_PAY_MAX_FIAT_AMOUNT`

Production also requires Alchemy Pay merchant onboarding, production credentials, a public HTTPS callback, and any outbound-IP allowlisting they require.

## 7. User experience

1. Add Funds appears in desktop and mobile navigation and the wallet modal.
2. Review shows fiat amount, USDC, Solana, abbreviated destination, provider, and environment.
3. Provider-calculated output and fees remain labeled as such; Flay does not invent a quote.
4. Explain that Alchemy Pay may require identity verification and payment methods vary by country.
5. Provide checkout reopen, status refresh, transaction explorer, wallet copy, and balance refresh controls.
6. Keep Convert and Futures usable while an order is pending.

## 8. Implementation blocks

### A. Server core

- Typed configuration/readiness, signing helpers, checkout endpoint, durable bounded order store, authenticated list/detail endpoints, and signing/validation tests.

### B. Callback and reconciliation

- Verified webhook, state machine, RPC transaction verification, restart recovery, replay/mismatch tests, and failure recovery.

### C. Interface

- Add Funds page, validation/review, new-tab launch, tracked orders, return/focus refresh, wallet integration, mobile design, and all unavailable/error states.

### D. Release proof

- Build/typecheck/tests/audits, sandbox checkout, signed callback proof, persisted restart proof, production small-value order when merchant access exists, and `ALCHEMY_PAY_COMPLETION_AUDIT.md`.

## 9. Acceptance criteria

1. Only the authenticated embedded wallet can create or read its orders.
2. Every checkout is USDC/SOL to the bound wallet; alteration attempts are impossible or rejected.
3. URL signing matches Alchemy Pay's documented canonical HMAC algorithm.
4. Secrets never reach the browser, logs, repository, or errors.
5. Merchant order IDs are unique, at most 48 characters, persisted before response, and bound to identity/wallet/fiat/amount.
6. Amount parsing rejects exponent notation, negative values, excess precision, unsupported fiat, and limit violations.
7. URLs use only the configured official host and expire after 24 hours.
8. Webhooks reject stale timestamps, invalid signatures, wrong app ID, unknown orders, and order-field mismatches.
9. Duplicate/out-of-order callbacks cannot duplicate records or regress success.
10. Provider success is not called received until RPC verifies the USDC delivery.
11. Orders survive restart on the configured durable path.
12. UI never collects payment credentials, opens checkout safely, and clearly displays test mode.
13. Desktop and mobile show useful pending, failed, expired, confirmed, and recovery states.
14. Sandbox generates an Alchemy-accepted checkout for the actual embedded wallet.
15. Valid signed callbacks update the correct order; invalid callbacks change nothing.
16. Production proof records provider order, transaction, verified receipt, and balance after credentials exist.
17. Build, typecheck, deterministic tests, browser audit, dependency audit, and release audit pass.
18. Setup docs cover onboarding, secrets, HTTPS, IP allowlisting, durable storage, rotation, and environments.

## 10. Completion rule

Do not claim completion until every criterion maps to code and evidence. Missing merchant credentials, sandbox/production access, public HTTPS callback, provider approval, founder payment, webhook, or onchain receipt evidence remains open.
# Flay minimum gasless implementation plan

Status: active implementation plan

This plan adds the smallest useful gasless path for the hackathon: Jupiter-managed sponsorship for eligible Convert market swaps. Flay does not fund a sponsor wallet, operate Kora, hold a sponsor key, or deploy a Solana program. Jupiter decides eligibility per prepared order and completes any provider signature through its `/execute` endpoint.

## 1. Product behavior

1. A user requests and reviews a Jupiter market swap as usual.
2. Flay prepares the order with the user's wallet as `taker` and without an integrator `payer`.
3. If Jupiter explicitly returns `gasless: true` and a valid `signatureFeePayer` different from the taker, Flay verifies that payer against the actual transaction and labels the order `Sponsored by Jupiter`.
4. The user signs the exact reviewed transaction with Privy. The wallet remains the authority for the swap and Flay never receives its private key.
5. Flay verifies the user's signature and unchanged message, then sends the partially signed transaction and original request ID to Jupiter `/execute`. Jupiter adds any required sponsor or market-maker signature and submits it.
6. If Jupiter does not sponsor an order, the existing user-paid flow remains available and is clearly labeled. Flay never promises or fakes gasless eligibility.

## 2. Scope

Included:

1. Jupiter market swaps in Convert.
2. Automatic Jupiter sponsorship and JupiterZ market-maker gas payment returned by `/swap/v2/order`.
3. Per-order sponsorship verification, review disclosure, signing, execution, receipt metadata, tests, and setup documentation.

Excluded:

1. Limit orders, Raydium, Orca, Futures, MagicBlock/PER, fiat deposits, wallet transfers, memes, and xStocks.
2. A Flay-funded payer, Kora or another relayer, a sponsor balance, private signing infrastructure, referral fees, and a custom Solana program.
3. A guarantee that every Jupiter order is gasless. Eligibility, routes, minimum trade size, and provider fees are controlled by Jupiter and can change per order.

## 3. Trust and validation boundary

1. Treat a prepared order as sponsored only when `gasless === true`, `signatureFeePayer` is a valid Solana public key, and it differs from the authenticated taker.
2. Deserialize the returned transaction and require its actual fee payer to equal `signatureFeePayer` for sponsored orders or the taker for user-paid orders.
3. Require the authenticated wallet to be a signer and reject any unrecognized required signer. A sponsored order may contain only the exact external signer addresses declared by that Jupiter response.
4. Persist the order request ID, original message bytes, wallet, quote, sponsorship metadata, expected fee payer, and allowed external signers in the short-lived prepared-order record.
5. On execute, require the signed transaction message to be byte-for-byte identical and cryptographically verify the taker's Ed25519 signature over it.
6. Sponsored partial transactions are simulated with signature verification disabled only because the provider signature is intentionally still absent. User-paid transactions retain full signature verification. Both paths simulate the exact signed message before `/execute`.
7. Fail closed on missing, malformed, contradictory, or changed sponsorship data. Do not downgrade an inconsistent sponsored response into a normal transaction.

## 4. Data contract

Prepared and execution responses expose safe gas-payment metadata:

- `mode`: `provider-sponsored` or `user-paid`.
- `provider`: `Jupiter` for sponsored orders, otherwise `null`.
- `feePayer`: the verified transaction fee payer.
- `signatureFeeLamports`, `prioritizationFeeLamports`, and `rentFeeLamports` when Jupiter provides them.
- `detail`: concise user-facing disclosure without secrets.

No sponsor credential or private signing material exists in Flay for this scope.

## 5. Fees and interface

1. Review shows `Network gas · Sponsored by Jupiter` only after the prepared transaction passes server validation.
2. Before preparation, the Jupiter route says eligibility is checked at review; it does not display a guaranteed gasless badge.
3. A sponsored review explains that Jupiter may recover sponsorship cost through the swap fee/output and that the quoted output already reflects provider fees.
4. A user-paid review continues to show the estimated SOL network fee and that the wallet pays it.
5. The signing button and success receipt identify a sponsored order without implying that other Flay features are gasless.
6. Non-Jupiter providers and every excluded product keep their existing gas behavior and labels.

## 6. Implementation blocks

### A. Shared contract and validator

- Add typed gas-payment metadata to prepared and execution responses.
- Support an explicitly expected fee payer and a bounded set of provider-declared external signers.
- Add Ed25519 verification for the authenticated wallet signature.
- Cover fee-payer, signer, altered-message, malformed-key, and altered-signature cases with deterministic tests.

### B. Jupiter adapter and execution

- Parse and validate Jupiter sponsorship, payer, router, gas fee, and rent fields.
- Store only verified sponsorship metadata from the prepared order.
- Preserve the exact request ID and message through partial signing.
- Use the partial-signature execution path only for verified sponsored Jupiter orders.
- Keep the full-signature behavior for user-paid and non-Jupiter paths.

### C. Convert interface

- Show gasless eligibility timing on the Jupiter route.
- Show verified sponsored/user-paid state in review, signing, success, and retry states.
- Disclose provider fee recovery and keep narrow/mobile layouts usable.

### D. Verification and release evidence

- Run type checking, deterministic tests, production build, browser audit, dependency audit, and release audit.
- Add a completion audit mapping every acceptance criterion to code and evidence.
- Record a live small-value eligible swap from a low-SOL embedded wallet, including the prepared payer and confirmed transaction, before claiming completion.

## 7. Acceptance criteria

1. The UI and documentation state that only eligible Jupiter Convert market swaps can be gasless.
2. Sponsorship is recognized only from an explicit `gasless: true` response with a valid fee payer different from the taker.
3. The actual transaction fee payer matches the recorded Jupiter payer; any mismatch is rejected before wallet signing.
4. The authenticated wallet is an exact required signer, and unknown required signers are rejected.
5. Execution accepts a partial provider signature only for the external signer addresses recorded from that prepared Jupiter order.
6. The taker's Ed25519 signature and the unchanged transaction message are verified before `/execute`.
7. Ineligible, malformed, contradictory, expired, or altered orders are never labeled or executed as sponsored.
8. Review and receipt disclose who pays network gas and that Jupiter may recover sponsorship cost through the quoted swap economics.
9. User-paid Jupiter orders and all excluded features retain honest user-paid behavior.
10. The implementation requires no Flay sponsor funds, sponsor secret, Kora service, referral fee, or custom program deployment.
11. Deterministic tests cover sponsored, user-paid, mismatch, tampering, idempotency, retry, and UI disclosure paths.
12. A founder-signed live eligible swap proves that a low-SOL Privy wallet can sign, Jupiter can co-sign/submit, and the transaction confirms with the recorded non-user fee payer.
13. Type checking, tests, production build, browser audit, dependency audit, and release audit pass.
14. Setup and operating documentation explain dynamic eligibility, supported scope, evidence collection, and safe fallback behavior.

## 8. Completion rule

Do not claim this minimum gasless block is complete until all fourteen criteria map to code and evidence in `MINIMUM_GASLESS_COMPLETION_AUDIT.md`. A missing live eligible order, wallet signature, provider co-signature, confirmed transaction, or required check leaves the block incomplete. Continue all implementation and deterministic verification that can be completed without the founder-signed transaction.
# Flay gasless USDC send implementation plan

Status: active implementation plan

This plan adds one tightly bounded gasless wallet action: sending mainnet USDC from the authenticated Privy embedded wallet to an existing Solana USDC account. Privy supplies the managed fee payer through its React SDK. Flay does not operate a sponsor wallet, receive a sponsor key, deploy a program, or claim that unrelated actions are gasless.

## 1. Product behavior

1. A signed-in user opens Funds, enters a recipient Solana wallet and an exact USDC amount, and requests review.
2. Flay binds the request to the embedded wallet in the verified Privy identity token.
3. The server confirms the sender balance and requires the recipient's canonical USDC associated token account to exist. The first release does not sponsor token-account rent.
4. The server builds and simulates a single USDC `TransferChecked` transaction with no account creation, account closure, arbitrary program call, memo, or hidden fee.
5. Review shows the sender, recipient, amount, token, sponsorship provider, Flay fee, recipient-account restriction, and transaction expiry.
6. The user approves the reviewed transaction through Privy. Flay calls Privy's Solana `signAndSendTransaction` with `sponsor: true`; Privy replaces the fee payer/blockhash, signs as fee payer, and broadcasts.
7. Flay records the returned signature locally, checks authoritative Solana activity, and shows pending, confirmed, or failed state with an Explorer link.

## 2. Included scope

1. Mainnet native USDC only: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, six decimals, legacy SPL Token program.
2. Privy embedded Solana wallets already used by Flay.
3. Recipient wallet validation and canonical associated-token-account verification.
4. Exact decimal parsing, positive amount, u64 limit, balance check, and sender/recipient separation.
5. Server-built versioned transaction containing exactly one `TransferChecked` instruction.
6. Server simulation before review.
7. Privy app-pays sponsorship from the client SDK.
8. Responsive Funds UI, explicit review, submission result, balance refresh, retry, and Explorer recovery.
9. Deterministic service, API, UI, and authentication tests plus build and release audits.

Excluded:

1. SOL transfers, arbitrary SPL tokens, Token-2022, off-ramp, fiat withdrawal, bank withdrawal, and exchange-custody withdrawal.
2. Creating a recipient ATA, paying recipient account rent, or any `CreateAccount`/`CloseAccount` instruction.
3. Futures collateral actions, MagicBlock/PER actions, Jupiter limit orders, and non-Privy wallets.
4. A Flay fee payer, private sponsor key, relayer, Kora node, delegated wallet access, or custom Solana program.
5. A fallback to wallet-paid gas. If sponsorship is unavailable, the send fails clearly before any success claim.

## 3. Trust and security boundary

1. Every prepare request requires a valid Privy identity token and an exact embedded-wallet match.
2. Server input schemas accept only canonical Solana public keys and positive integer atomic amounts within u64.
3. The server derives both canonical USDC ATAs and verifies the recipient ATA already exists, belongs to the legacy SPL Token program, and stores USDC for the reviewed recipient.
4. The server checks the authenticated wallet's confirmed USDC balance immediately before building.
5. The serialized transaction has the authenticated wallet as its initial fee payer/authority, one required signer, no lookup table, and exactly one allowed instruction: USDC `TransferChecked` for the reviewed amount and recipient ATA.
6. The server simulates the exact unsigned message with signature verification disabled only because user and Privy signatures do not yet exist.
7. The browser does not construct transfer instructions or choose a mint/program. It submits only the server-produced transaction to Privy with `sponsor: true`.
8. The Privy confirmation interface remains visible. The user must approve every send.
9. No private key, wallet signature, identity token, serialized transaction, or sponsor credential is stored in activity history or logged.
10. The UI never says confirmed until Solana RPC confirms the submitted signature. A broadcast response is labeled submitted or pending.
11. Prepare is rate-limited per server/IP and Privy's dashboard must have conservative sponsorship caps and client sponsorship enabled only for the hackathon deployment.

## 4. Data contract

The prepare response exposes:

- `preparedId`, authenticated `wallet`, `recipient`, `transaction`, `messageHash`, and `expiresAt`.
- Fixed token metadata for mainnet USDC.
- `amountAtomic` and formatted amount.
- `gasPayment.mode = provider-sponsored`, `provider = Privy`, and disclosure that Flay charges 0%.
- Recipient ATA and review warnings.

The browser stores only safe recent-send metadata: signature, recipient, amount, creation time, and current onchain status. Solana activity remains the authoritative receipt.

## 5. Interface

1. Funds contains a `Send USDC` card beside the receiving-wallet information.
2. Signed-out state prompts login; missing wallet/balance states remain explicit.
3. Recipient and amount validate before prepare. A Max shortcut uses the confirmed USDC balance because gas is sponsored.
4. Review is a separate modal or panel and repeats the full recipient address and exact amount.
5. The approval action says `Approve gasless send`, names Privy as gas sponsor, and never implies that all Flay actions are gasless.
6. Submission shows the signature, pending/confirmed/failed state, Explorer link, retryable status refresh, and updated wallet balance.
7. Sponsorship-disabled, insufficient-credit, simulation, expired-review, rejected-wallet, RPC, and recipient-account errors remain actionable and do not white-screen the app.
8. Desktop and mobile layouts keep all fields, warnings, and recovery controls readable.

## 6. Implementation blocks

### A. Shared contract and server preparation

- Add shared prepared-send and recent-send types.
- Add strict request schemas.
- Build a dedicated transfer service that verifies accounts/balance, constructs one USDC transfer, validates its compiled message, simulates it, and retains only short-lived review records.
- Add authenticated, rate-limited prepare endpoint and truthful health metadata.

### B. Privy execution bridge

- Extend the auth bridge with a sponsored Solana sign-and-send method.
- Pass only the server-produced transaction, `sponsor: true`, mainnet chain, visible wallet confirmation, simulation enabled, and non-optimistic broadcast.
- Encode the returned 64-byte signature safely and reject malformed SDK results.

### C. Funds interface and recovery

- Add the Send USDC form, Max control, review, approval, errors, result state, status refresh, Explorer link, and balance refresh.
- Persist a bounded recent-send list without identity tokens or transaction bytes.
- Use a dedicated authenticated status endpoint that validates the exact onchain USDC instruction, recipient credit, and external fee payer before returning confirmed state.

### D. Verification and release evidence

- Unit-test amount/address/balance/account validation, exact instruction construction, forbidden instruction absence, simulation failures, and identity protection.
- Test the Privy sponsored-call options and Funds UI disclosures without broadcasting.
- Run typecheck/build, deterministic tests, dependency audit, release audit, and desktop/mobile browser audit.
- Complete one founder-approved small mainnet USDC send to an already initialized recipient, record its signature, confirm recipient credit, and verify the sender paid zero lamports.
- Write `GASLESS_USDC_SEND_COMPLETION_AUDIT.md` mapping every acceptance criterion to code and evidence.

## 7. Acceptance criteria

1. Only the authenticated embedded wallet can prepare its send.
2. Only mainnet legacy USDC can be sent; the client cannot choose mint, decimals, or token program.
3. Invalid/noncanonical/self recipient, zero/negative/exponent/excess-precision/over-u64 amount, and insufficient USDC are rejected.
4. The recipient's canonical USDC ATA must already exist and must match the reviewed recipient and mint.
5. The server-produced transaction has one wallet signer and exactly one USDC `TransferChecked` instruction for the reviewed amount and destination.
6. No account create, account close, SOL transfer, arbitrary program, lookup table, memo, or hidden fee exists in the prepared transaction.
7. Exact transaction simulation passes before review; simulation errors fail closed.
8. Privy execution receives the prepared bytes with `sponsor: true`, visible approval, mainnet chain, simulation enabled, and optimistic broadcast disabled.
9. No wallet-paid fallback occurs when Privy sponsorship is unavailable.
10. Review clearly shows exact amount, full recipient, USDC, Privy sponsorship, 0% Flay fee, and the existing-account restriction.
11. Submission never appears confirmed before RPC evidence and always exposes an Explorer recovery link.
12. Pending, confirmed, failed, user-rejected, sponsorship-disabled, credit-exhausted, expired, RPC, and malformed-signature cases produce usable states without a blank screen.
13. Recent sends remain bounded and contain no secret, identity token, signature bytes beyond the public transaction ID, or serialized transaction.
14. Desktop and mobile browser audits show a usable Funds send flow.
15. Setup documentation covers Privy TEE execution, prepaid/postpaid billing, Solana mainnet enablement, client sponsorship, spend caps, and recipient-ATA limitation.
16. Build/typecheck, deterministic tests, dependency audit, and release audit pass.
17. A founder-approved live mainnet send confirms exact recipient USDC credit and zero sender lamport fee debit.

## 8. Completion rule

Do not claim 100% completion until all 17 criteria map to actual code and evidence in `GASLESS_USDC_SEND_COMPLETION_AUDIT.md`. A missing Privy billing balance, dashboard sponsorship setting, TEE execution setting, initialized recipient USDC account, founder signature, confirmed mainnet receipt, or fee-delta evidence remains explicitly open. Complete every deterministic and read-only verification before reporting an external blocker.
# Flay Privy fiat onramp implementation plan

**Status:** active implementation scope  
**Initial environment:** Privy sandbox  
**Destination:** native USDC on Solana mainnet-format wallet addresses  
**Custody:** funds go directly to the authenticated exportable Privy wallet

## 1. Product behavior

1. A signed-in user opens Funds, chooses a supported fiat currency and starting amount, and launches Privy's card-onramp modal.
2. Flay binds the destination to the authenticated embedded Solana wallet. The browser cannot substitute another address, asset, or network through the Funds form.
3. Privy selects an available regulated provider from its supported onramp set. The provider owns payment-method collection, KYC, pricing, fees, regional eligibility, and crypto delivery.
4. Flay never receives card data, bank credentials, or KYC documents and charges no onramp fee.
5. Sandbox is the safe default. Production requires an explicit public environment setting and the corresponding Privy dashboard/provider configuration.
6. A submitted or confirmed provider result closes the flow cleanly, explains its status, and refreshes the authoritative Solana USDC balance. Cancellation and provider errors remain retryable without a blank screen.

## 2. Included scope

1. Privy's React `useFiatOnramp` flow inside the existing `PrivyProvider`.
2. The authenticated Privy embedded Solana wallet as the fixed destination.
3. Solana native USDC mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` and Solana mainnet CAIP-2 chain `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`.
4. Privy sandbox and explicit production opt-in through a public, non-secret build setting.
5. The immediately available card currencies USD, EUR, AUD, and BRL. Broader currencies, including BDT, are described as requiring Meld configuration and KYB rather than shown as guaranteed.
6. Card, Apple Pay, Google Pay, and other methods only when Privy's selected provider offers them for the user's region.
7. Funds-page status, provider boundary, wallet destination, balance refresh, accessibility, responsive behavior, tests, setup documentation, and release evidence.

## 3. Excluded scope

1. Off-ramp, fiat withdrawal, bank payout, debit-card issuance, or exchange custody.
2. Flay collection or storage of payment, bank, identity, or KYC information.
3. A Flay payment processor, merchant-of-record role, custom checkout, custom Solana program, or server-side wallet signing.
4. Guaranteed payment methods, currencies, fees, quotes, approval, or geographic availability.
5. Production BDT support before Meld KYB and provider availability are verified.
6. Removal of the paused Alchemy Pay implementation or its historical plan/checkpoint; it remains dormant as a possible later fallback.

## 4. Trust and configuration boundary

1. The onramp launch method exists only inside the configured `PrivyProvider` bridge.
2. The bridge ignores arbitrary destination data from page inputs and supplies the currently authenticated embedded Solana wallet, fixed Solana chain, and fixed USDC mint.
3. The page can supply only a validated supported fiat currency and a bounded decimal starting amount.
4. Sandbox is selected unless `VITE_PRIVY_ONRAMP_ENV=production` is explicitly set at build time. This value is public configuration and must contain no secret.
5. The Privy modal remains visible and owns provider choice, final quote, fees, KYC, payment authorization, and completion state.
6. Flay treats `submitted` as pending and `confirmed` as provider-confirmed, then refreshes Solana balances. It does not invent an order, transaction hash, or settled balance.
7. Cancellation, rejection, unsupported region, provider outage, and incomplete dashboard configuration are presented as actionable errors.

## 5. Interface

1. Replace the inactive Alchemy Pay card with a Privy onramp card while preserving the existing Funds and gasless-send layout.
2. Clearly show Privy as the orchestrator and Stripe, Meld, MoonPay, or Coinbase as possible providers selected by availability.
3. Show Sandbox prominently until production is explicitly configured.
4. Display the full receiving wallet, Solana USDC destination, no Flay custody, and 0% Flay fee.
5. Keep the launch action usable only after authentication, wallet readiness, valid currency, and valid amount.
6. Show submitted, confirmed, cancelled, and failed outcomes without claiming onchain receipt before the refreshed wallet balance reflects it.
7. Remove active Alchemy checkout creation, tracking, callback-return, and merchant-credential messaging from the shipped Funds flow.

## 6. Implementation blocks

### A. Privy bridge

- Add a typed fiat-onramp method and environment to `FlayAuth`.
- Initialize `useFiatOnramp` under `PrivyProvider`.
- Bind Solana CAIP-2, native USDC mint, and embedded wallet address inside the bridge.
- Normalize provider errors and return only `submitted` or `confirmed` to the page.

### B. Funds interface

- Replace the Alchemy checkout state and API calls with the Privy modal launcher.
- Keep safe amount/currency validation and direct-wallet disclosures.
- Add pending/confirmed result feedback and balance refresh.
- Keep card/KYC data outside Flay and preserve the gasless USDC-send block.

### C. Health and documentation

- Report Privy onramp as the active fiat provider in health metadata while retaining the paused Alchemy capability record.
- Document dashboard enablement, allowed origins, sandbox testing, production opt-in, regional limitations, and Meld KYB for broader currency coverage.
- Preserve `ALCHEMY_PAY_WAITING_STATUS.md` and related implementation files as inactive fallback history.

### D. Verification

- Unit-test fixed destination options, sandbox default, production opt-in, amount/currency validation, result handling, and errors.
- Run the full deterministic test suite, TypeScript/production build, release audit, dependency audit, and desktop/mobile browser audit.
- Complete one founder-operated Privy sandbox checkout and record the visible provider result before any 100% completion claim.

## 7. Acceptance criteria

1. Funds launches Privy's onramp modal through the configured Privy React SDK.
2. The destination is always the authenticated embedded Solana wallet, native Solana USDC mint, and exact Solana mainnet CAIP-2 chain.
3. Page-controlled input cannot override destination wallet, mint, chain, or provider result.
4. Sandbox is the default and production requires explicit configuration.
5. Only supported fiat values and bounded decimal amounts reach the bridge.
6. The UI names Privy and possible downstream providers without promising a provider, payment method, fee, quote, or country.
7. Flay collects and stores no card, bank, or KYC data.
8. Submitted, confirmed, cancelled, provider-error, unsupported-region, and missing-configuration outcomes remain understandable and retryable.
9. A successful provider result triggers an authoritative wallet-balance refresh without fabricating settlement or transaction history.
10. The active Funds flow makes no Alchemy checkout/order API request and shows no Alchemy merchant-credential blocker.
11. Desktop and mobile layouts remain usable, keyboard accessible, and free of runtime exceptions.
12. Health and setup documentation truthfully describe the active provider, sandbox state, production switch, and Meld KYB requirement for BDT/broader coverage.
13. No private key, Privy secret, payment data, identity document, or provider credential is added to client code, logs, or repository files.
14. Type checking, deterministic tests, production build, release audit, dependency audit, and browser audit pass.
15. A founder-operated sandbox checkout opens for the bound wallet and produces a real Privy provider submitted/confirmed outcome.

## 8. Completion rule

Do not claim this block is 100% complete until all fifteen acceptance criteria map to actual code and evidence in `PRIVY_FIAT_ONRAMP_COMPLETION_AUDIT.md`. Missing Privy dashboard enablement, provider sandbox access, founder interaction, or provider result leaves criterion 15 open. Complete all deterministic implementation and verification before reporting that external gate.

# Privy onramp isolated-checkout recovery plan

**Status:** active reliability addendum  
**Parent plan:** `HACKATHON_PRIVY_FIAT_ONRAMP_PLAN.md`

## Problem

Privy's embedded Stripe/MoonPay flow owns a full-screen modal. A provider SMS or KYC step can remain pending indefinitely, which blocks every Flay navigation control in that browser tab even though Flay's server and trading APIs remain healthy.

## Design

1. Funds opens a dedicated same-origin Flay checkout tab with only validated fiat and amount in its URL.
2. The checkout tab loads the existing authenticated Privy session and requires a deliberate **Continue to provider** click.
3. The existing bridge continues to bind the authenticated embedded wallet, native Solana USDC mint, exact Solana mainnet CAIP-2 chain, and configured environment. No destination data comes from the URL.
4. Privy's modal and provider flow run only in the checkout tab. If SMS, KYC, or provider UI stalls, the user can close that tab while the original Flay trading tab remains usable.
5. A real Privy `submitted` or `confirmed` result is sent to the original same-origin tab through `BroadcastChannel`; the original tab validates the message, shows the result, and refreshes the authoritative USDC balance.
6. Returning focus to the original tab also refreshes balance after a checkout was opened. No purchase, settlement, or transaction is fabricated.

## Acceptance criteria

1. A valid Funds action opens a separate checkout tab synchronously from the user gesture.
2. Invalid fiat or amount cannot create a checkout intent.
3. Wallet, mint, chain, and environment remain bridge-controlled and absent from checkout URL input.
4. Checkout requires authenticated wallet readiness and a deliberate provider-launch action.
5. A stuck provider modal cannot cover or disable the original Flay tab.
6. Only validated `submitted` or `confirmed` messages for the current wallet update Funds state.
7. Returning to Funds refreshes the Solana balance without claiming success.
8. Popup blocking, cancellation, provider failure, and manual tab closure remain recoverable.
9. Desktop/mobile layout, focused tests, full tests, production build, release audit, and browser audit pass.
10. The parent completion audit records the live Stripe SMS stall and this recovery behavior; criterion 15 remains open until a real provider result is observed.

## Completion rule

Do not claim the fiat block complete until every criterion above maps to code and verification evidence and the parent plan's live `submitted`/`confirmed` criterion is satisfied.

# Flay Raydium and Orca gasless Convert plan

**Status:** complete — see `XSTOCKS_LIVE_PRICE_FALLBACK_AUDIT.md`  
**Dependency:** Privy managed Solana gas sponsorship already enabled for Flay  
**Deployment rule:** no Flay program, sponsor private key, or Kora service

## 1. Product behavior

1. Flay keeps comparing live Jupiter, Raydium, and Orca market quotes by output.
2. Jupiter keeps its existing provider-managed sponsorship path.
3. Eligible Raydium and Orca market swaps use Privy's managed Solana sponsorship and broadcast flow.
4. Sponsorship is decided only after the venue builds a fresh transaction and Flay validates the exact route.
5. The review and receipt identify Jupiter or Privy as the gas sponsor. Flay never promises sponsorship before eligibility is checked.
6. If an order is unsafe or unsupported for sponsorship, it remains visibly user-paid; Flay never silently charges SOL after displaying a sponsored review.

## 2. Initial eligibility boundary

Privy sponsorship is allowed only when all conditions pass:

1. The provider is Raydium or Orca and the action is a market swap.
2. Input and output are SPL tokens rather than native SOL.
3. The wallet's exact input and output associated token accounts already exist.
4. The venue returns one Solana v0 transaction.
5. The wallet is a required signer and is the fee payer in the reviewed pre-sponsorship message.
6. Flay validates the requested mints, exact input, minimum output, route programs, pool accounts, signer set, and simulated deltas.
7. The message contains no direct account-creation, account-close, rent-transfer, or unreviewed system action that could charge Privy or refund rent to the user.

Native SOL wrapping, missing output accounts, multi-transaction routes, Trigger orders, Futures, MagicBlock, fiat, arbitrary transfers, and any transaction that fails these checks stay outside this block.

## 3. Execution boundary

1. The browser receives only a short-lived server-validated prepared transaction.
2. Privy shows the wallet approval, sponsors the fee, signs, and broadcasts with simulation enabled.
3. Flay sends the returned signature and prepared ID to an authenticated completion endpoint.
4. The server fetches the confirmed transaction from Solana and requires the authenticated wallet, reviewed programs, pool, mints, exact input debit, minimum output credit, and a non-user fee payer.
5. The server requires zero SOL fee debit from the user for sponsored SPL-to-SPL swaps.
6. Completion is idempotent. A different signature for an already completed preparation is rejected.
7. The ordinary signed-transaction execution endpoint rejects a preparation marked for Privy sponsorship, preventing double submission or an accidental user-paid fallback.

## 4. Interface

1. Route cards say sponsorship eligibility is checked at review for all three providers.
2. A verified Raydium or Orca review displays `Sponsored by Privy` and explains the eligibility boundary.
3. Ineligible reviews display `Paid by your wallet` with the estimated fee when available.
4. The approval copy names the venue swap rather than the USDC-send flow.
5. Success and Activity store the real Solana signature and sponsor identity.

## 5. Verification

1. Deterministic tests cover eligibility, unsafe account/rent instructions, sponsored UI disclosure, endpoint authentication, idempotency, signature mismatch, fee payer mismatch, wallet SOL debit, exact input debit, and minimum output.
2. Type checking, production build, full tests, browser audit, dependency audit, and release audit pass.
3. Founder live acceptance uses the smallest practical Raydium and Orca SPL-to-SPL swaps from a wallet with insufficient SOL for gas and records both confirmed signatures and actual fee payers.

## 6. Acceptance criteria

1. Eligible Raydium and Orca prepared transactions are labeled with Privy sponsorship only after all server checks pass.
2. Sponsored execution uses Privy's managed payer and requires no Flay sponsor secret or custom program.
3. Native SOL, missing token accounts, account creation/closure, rent movement, unknown programs/signers, and multi-transaction routes cannot enter this sponsored path.
4. The prepared transaction is bound to the authenticated wallet, fresh quote, venue, pool, mints, exact input, and minimum output.
5. Privy simulation remains enabled and sponsorship failure stops without charging the wallet SOL.
6. The completion endpoint verifies the confirmed onchain transaction and rejects an error, wrong signature, wrong wallet, wrong route, wrong amounts, user fee payment, or altered preparation.
7. Repeated completion returns the same result; conflicting completion and ordinary execution attempts fail safely.
8. Review, approval, success, and Activity show truthful provider and sponsorship information.
9. Existing Jupiter sponsored and user-paid paths continue to work.
10. Deterministic and release checks pass.
11. A live low-SOL Raydium transaction and a live low-SOL Orca transaction confirm with non-user fee payers before this block is declared complete.

## 7. Completion rule

Do not call this block complete until every acceptance criterion is mapped to code and evidence in `RAYDIUM_ORCA_GASLESS_COMPLETION_AUDIT.md`. Missing Privy credits, a missing live venue route, wallet approval, transaction signature, non-user fee payer proof, or confirmed onchain deltas leaves the corresponding live criterion open. Continue all implementation and deterministic verification that does not require the founder's wallet approval.
# Flay exact SOL affordability fix plan

**Status:** active reliability fix  
**Parent scope:** `HACKATHON_RAYDIUM_ORCA_GASLESS_PLAN.md`

## Problem

Potentially sponsored Convert routes first check token principal without a SOL reserve. If the freshly built transaction is ultimately user-paid, Flay currently re-applies a fixed 0.005 SOL reserve before simulation. That rejects affordable transactions whose exact network fee and one token-account rent payment are below 0.005 SOL. It also prevents the one-time output-account setup needed before a direct Raydium or Orca route can become eligible for Privy sponsorship.

## Design

1. Keep the principal-only precheck for Jupiter and eligible-candidate Raydium/Orca SPL routes.
2. Build and structurally validate the fresh provider transaction before deciding its final gas mode.
3. Run the exact Solana simulation against current wallet state. The simulation remains the affordability authority for the built user-paid transaction, including its actual fee, priority fee, rent, and account creation.
4. Return the simulated wallet lamport delta from transaction validation without weakening the existing exact input and minimum-output checks.
5. If the transaction is user-paid, show the estimated total wallet SOL debit and separate the known network fee from the remaining simulated debit, which can include rent.
6. If the transaction is Privy- or Jupiter-sponsored, retain its existing provider payment disclosure and do not report simulated user-paid rent.
7. Keep the conservative 0.005 SOL precheck for paths that are not rebuilt and simulated under this candidate-sponsorship flow.
8. Do not expand Privy sponsorship to missing token accounts, account creation, rent, native SOL, or account closure. The first account-creation transaction remains visibly wallet-paid.
9. Treat an expected SPL asset as transaction-bound when either its mint or its exact canonical wallet token account is present. This supports Orca Whirlpool instructions that use canonical token accounts without listing the mint, while preserving the same mint-to-wallet derivation and writable-account checks.
10. Decode simulation logs for rent shortfalls and return the available lamports, required lamports, and difference instead of a generic program error.

## Acceptance criteria

1. A user-paid candidate-sponsorship transaction is no longer rejected solely because the wallet has less than the fixed 0.005 SOL reserve.
2. The exact prepared transaction must still pass Solana simulation; an unaffordable fee or rent payment fails before signing.
3. Input token balance, signer, venue, pool, mint, program, exact input, and minimum-output validation remain unchanged.
4. User-paid review shows the simulated total SOL debit and identifies any debit beyond the known network fee as account rent or other transaction-required SOL.
5. Privy sponsorship still requires both token accounts to exist and every safety check in the parent plan.
6. Jupiter-sponsored, Privy-sponsored, user-paid, limit, Futures, MagicBlock, fiat, and USDC-send boundaries remain truthful.
7. Deterministic tests, type checking, production build, full tests, browser audit, release audit, dependency audit, and local runtime health pass.
8. The founder wallet can reach review for the smallest practical USDC-to-USDT setup transaction if its exact simulation proves the current SOL balance sufficient.
9. A legitimate direct Orca transaction is not rejected merely because the Whirlpool instruction binds canonical token accounts without listing both mint keys.
10. A route that needs more account rent than the wallet holds reports the exact SOL shortfall before signing.

## Completion rule

Do not call this fix complete until every acceptance criterion is compared with the code and recorded in `EXACT_SOL_AFFORDABILITY_FIX_AUDIT.md`. The parent Raydium/Orca block still requires its separate live sponsored transaction evidence.

# MagicBlock live-readiness fix plan

**Status:** active security and reliability fix

## Problem

Flay currently treats a healthy MagicBlock HTTP endpoint and initialized USDC mint as proof that private PER access is live. On 2026-09-23, the configured mainnet endpoint returned a challenge prefixed with `MOCK:`, accepted an intentionally invalid signature, returned `mock-auth-token`, and allowed that token to query another wallet address. The UI therefore must not describe this provider state as protected or ready, and it must not ask the user to sign a meaningless challenge.

## Design

1. Extend MagicBlock readiness with an explicit authorization mode and human-readable detail.
2. Probe the official challenge endpoint during readiness checks and treat an explicitly mock challenge as unavailable for private access.
3. Reject a mock challenge again at the login-flow boundary so cached or stale readiness cannot expose the signing prompt.
4. Stop before balance login when readiness is unavailable, disable the unlock action, and show the provider condition in the wallet and MagicBlock views.
5. Make `/api/health` use the same live readiness result instead of reporting MagicBlock ready solely because a base URL exists.
6. Once MagicBlock returns verified authorization, use the explicit Flay unlock click as consent and sign the login challenge through Privy's embedded wallet without depending on a second modal layer that can stall on mobile.
7. Keep all tokens server-side and preserve the existing exact transaction validation and user-signing boundary for deposits, transfers, and withdrawals.

## Acceptance criteria

1. A `MOCK:` challenge produces `available: false`, `privateTransfers: false`, and `authorizationMode: mock`.
2. Flay never sends a mock challenge to Privy for signing.
3. The MagicBlock card and modal say the provider authorization is unavailable and provide no active unlock button while mock mode is detected.
4. `/api/health` reports MagicBlock readiness from the live probe.
5. A normal non-mock challenge preserves the existing login, balance, prepare, and execution paths.
6. Relevant tests, type checking, production build, release audit, and local status checks pass.
7. The block is not described as live until MagicBlock's endpoint stops accepting mock authorization and a founder wallet completes the authenticated flow.

## Completion rule

Compare this plan with the final code and live endpoint evidence before making any completion claim. Provider mock mode or missing founder-wallet acceptance keeps live MagicBlock readiness incomplete.

# MagicBlock real authorization plan

**Status:** implementation verified; founder-wallet acceptance remains open

## Objective

Replace the mock-backed Private Payments login endpoints with MagicBlock's attested mainnet TEE authorization service while continuing to use the official Private Payments builders and keeping every provider token on Flay's server.

## Design

1. Add a separately configurable MagicBlock TEE endpoint, defaulting to `https://mainnet-tee.magicblock.app`.
2. Verify the TEE endpoint's hardware attestation with MagicBlock's official SDK and fail closed if attestation cannot be verified.
3. Fetch login challenges from `/auth/challenge` on the TEE endpoint and submit signatures to `/auth/login` on that same endpoint.
4. Retain the returned bearer token only in Flay server memory and use it for private-balance, private-transfer, withdrawal, and ephemeral submission requests through the Private Payments API.
5. Keep the MagicBlock account mounted and visibly show its signing stage while requesting Privy's message signature. During that stage, place Flay below Privy's documented modal layer and disable Flay pointer interception so the real approval surface remains visible and tappable. If Privy signs immediately, require the same server-side Ed25519 verification and expose the resulting non-secret authorization receipt.
6. Report MagicBlock ready only when the Private Payments service, initialized USDC mint, TEE attestation, and real non-mock authorization challenge all pass.
7. Update deterministic and opt-in live tests to cover the separate TEE and payments endpoints, including rejection of an invalid TEE signature.
8. Make the browser unlock operation self-recovering: expose its current stage, apply a bounded timeout to every remote/signing step, ignore late results after failure, and always restore the retry action.
9. After a successful private-balance read, display a non-secret authorization receipt containing the server-verified wallet-signature result, attested TEE result, provider-token acceptance, authorization time, expiry, and a one-way receipt fingerprint.
10. Reject provider authorization tokens explicitly marked as mock even when the challenge itself was non-mock.
11. Pin Flay to the current Privy React SDK before further browser diagnosis, enable embedded-wallet approval UI globally as well as on the MagicBlock signing call, and verify that the SDK returns either a signature or a surfaced rejection instead of leaving its promise pending. Keep the existing timeout as recovery, not as the normal result.

## Acceptance criteria

1. The configured TEE endpoint returns a non-mock challenge and rejects an invalid signature.
2. A valid signature obtains a real bearer token from the TEE endpoint.
3. That token successfully authorizes the official Private Payments private-balance endpoint.
4. Flay never returns or logs the bearer token.
5. Local `/api/magicblock/status` reports verified authorization only after TEE attestation succeeds.
6. The browser unlock flow no longer depends on the mock `/v1/spl/login` endpoint and never dismisses the MagicBlock account while waiting for Privy. It returns control in the same dialog after approval, immediate Privy signing, rejection, or timeout.
7. Existing deposit, private-transfer, withdrawal, signer, account, amount, program, and network validation remains intact.
8. Focused tests, full tests, type checking, production build, release audit, browser audit, dependency audit, and opt-in live MagicBlock verification pass.
9. Founder-wallet acceptance confirms unlock and private balance before the live user flow is declared complete.
10. A stalled Privy or network request cannot leave the MagicBlock modal busy indefinitely; the UI names the failed stage and permits a retry.
11. The unlocked UI visibly proves which live checks passed and never exposes the MagicBlock bearer token or raw signature.
12. A mock authorization token can never create an unlocked Flay session.
13. While waiting for Privy, the Flay overlay has a lower stacking layer and cannot intercept taps intended for Privy's approval controls.
14. The pinned Privy SDK opens or completes the embedded Solana message-signing flow for the founder wallet; the one-minute timeout is not treated as successful acceptance.

## Completion rule

Compare this plan with the final code and record the evidence in a completion audit. Missing TEE attestation, real-token verification, or founder-wallet acceptance keeps the corresponding acceptance criterion open.

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

# Flay xStocks executable-route reliability fix

**Status:** implementation complete; evidence in `XSTOCKS_EXECUTABLE_ROUTE_FIX_AUDIT.md`  
**Date:** 2026-09-24  
**Scope:** xStocks quote-to-review boundary only

## Problem

Stocks currently requests a Jupiter Swap V2 price without the authenticated wallet and labels that result `LIVE`. Review then requests a wallet-bound order. Jupiter can price an amount that it cannot build for that wallet because of balance, gas, associated-token-account, or gasless-minimum requirements. For a `0.01 USDC` AAPLx purchase from the founder wallet, the quote-only request returned a price while the wallet-bound request failed. Supplying custom slippage also changed Jupiter's useful `Minimum $5 for gasless` response into the vague `Failed to get quotes` response.

## Implementation

1. Extend the internal Jupiter quote request with an optional authenticated execution wallet and an explicit Meta-Aggregator or Router mode.
2. Scope the quote cache and in-flight deduplication key by execution wallet and Jupiter mode so one wallet can never receive another wallet's executable route.
3. Make xStocks use the wallet-bound Jupiter Swap V2 Router `/build` path. This avoids the Meta-Aggregator's `$5` automatic-gasless minimum for the reproduced small xStock order while retaining Jupiter Metis routing and the user's selected slippage.
4. Validate the Router response, assemble its bounded instructions and lookup tables into a v0 transaction, simulate to set a bounded compute-unit limit, and reject the route before it reaches the UI if it cannot be built or simulated.
5. Preserve the selected wallet-bound Router transaction through the existing expiring quote snapshot and reuse that exact transaction during preparation. Continue to run Flay's signer, fee-payer, program, mint, amount, minimum-output, simulation, and authenticated-wallet validation before Privy approval.
6. Keep Convert behavior unchanged: public Convert quotes may remain quote-only and are rebuilt against the wallet during Review.
7. Update Stocks copy so it identifies the executable Jupiter Metis Router path and truthfully displays the requested/provider-returned slippage.
8. Add regression tests for wallet propagation, cache isolation, non-executable order rejection, Jupiter error mapping, and exact prepared-order reuse.
9. Update the live read-only xStocks test so a passing route must contain a wallet-bound executable transaction. Record small-balance/minimum evidence without signing or spending.

## Acceptance criteria

1. Stocks never labels a quote `LIVE` unless Jupiter built a non-empty transaction for the authenticated wallet and exact amount.
2. A quote belonging to one wallet cannot be reused or prepared by another wallet.
3. The reproduced `0.01 USDC → AAPLx` request uses the Router path instead of failing at the Meta-Aggregator's `$5` gasless minimum; a genuine SOL/rent shortfall remains explicit and actionable.
4. Stocks sends and displays its chosen slippage and the provider-returned minimum output truthfully.
5. Review reuses the still-valid wallet-bound Jupiter Router transaction that produced the displayed stock quote and still passes every existing transaction-security and simulation check.
6. Convert, Futures, Funds, Activity, MagicBlock, gasless boundaries, and wallet export remain unchanged and pass regression tests.
7. Focused tests, full tests, type checking, production build, release audit, browser audit, local health, and opt-in live read-only verification pass.
8. `XSTOCKS_EXECUTABLE_ROUTE_FIX_AUDIT.md` compares every criterion with the final code before this fix is declared complete.

## Completion rule

Do not declare this fix complete until all eight criteria are mapped to actual code and current verification evidence. A live user spend is never automated; read-only proof must verify whether Jupiter returned a transaction for the exact wallet and amount.

# Flay stock-directory visibility fix

**Status:** implementation complete; evidence in `STOCK_DIRECTORY_VISIBILITY_FIX_AUDIT.md`  
**Date:** 2026-09-24

## Problem

The server returns 1,124 official Solana xStocks and verified featured assets load correctly, but the interface defaults to Apple. On narrow screens the full directory appears below the Apple trade ticket, so users can reasonably conclude that Apple is the only supported stock.

## Implementation

1. Keep Apple as the initial asset but add an immediately visible featured-stock switcher to the trade card.
2. Include Apple, NVIDIA, Tesla, Microsoft, Amazon, Alphabet, Meta, SPY, and QQQ when present in the official catalog.
3. Show the full official catalog count and provide an `All stocks` action that scrolls to the searchable directory.
4. Increase the default directory preview while preserving search across the complete server-returned catalog.
5. Keep canonical server-side mint selection, quoting, and transaction security unchanged.
6. Verify responsive rendering, featured selection, full-catalog search, tests, build, and local runtime.

## Acceptance criteria

1. The Stocks screen visibly communicates that more than Apple is supported before the user scrolls.
2. Every featured button is derived from the official catalog and changes the selected trade asset.
3. Search still filters all 1,124 current catalog entries rather than only the preview.
4. Desktop and mobile remain free of horizontal overflow.
5. Existing stock execution and application regressions pass.

## Completion rule

Compare all five criteria with final code and current verification before declaring this visibility fix complete.

# Flay Privy MoonPay fallback fix

**Status:** superseded on 2026-09-24 by `PRIVY_AUTOMATIC_ONRAMP_ROUTING_RESTORE_PLAN.md`; retained as historical evidence  
**Date:** 2026-09-24

## Problem

The production Add Funds flow currently enters Privy's automatic card-onramp route and can stop at a regional Stripe-unavailable screen even when MoonPay is enabled. The installed Privy SDK's public `useFiatOnramp` options do not expose a provider override, while its established `useFundWallet` flow supports MoonPay as an explicit preferred card provider for Solana wallet funding.

## Implementation

1. Preserve Privy's automatic Stripe, Meld, MoonPay, and Coinbase routing as the primary checkout.
2. Add a MoonPay-specific Privy fallback that targets the same authenticated Solana wallet and USDC asset, with `preferredProvider: 'moonpay'`.
3. Automatically invoke that fallback when the primary Privy promise rejects with a Stripe-unavailable error.
4. Add an always-visible `Use MoonPay instead` action in the isolated checkout because provider-owned modal errors may remain inside Privy's UI and never reach Flay's promise boundary.
5. Keep payment, KYC, regional eligibility, quotes, and private data entirely inside Privy's provider UI.
6. Keep the original Flay trading tab isolated from provider stalls and preserve all non-fiat app behavior.

## Acceptance criteria

1. The normal checkout still uses Privy's current automatic provider routing.
2. A Stripe-unavailable rejection triggers one MoonPay-preferred retry without looping.
3. The isolated checkout lets the user launch MoonPay directly without first entering Stripe.
4. Both paths bind the authenticated embedded Solana wallet and native Solana USDC destination; no provider secret or card/KYC data enters Flay.
5. Focused tests cover provider selection, fallback detection, destination configuration, cancellation, and error copy.
6. Type checking, production build, full tests, release audit, browser audit, and local health pass with no regression.

## Completion rule

Compare all six criteria with final code and current verification evidence in `PRIVY_MOONPAY_FALLBACK_FIX_AUDIT.md` before declaring this fix complete.

# Flay Privy automatic onramp routing restore

**Status:** failed live acceptance on 2026-09-24; superseded by `PRIVY_REGION_ROUTING_CORRECTION_PLAN.md`  
**Date:** 2026-09-24  
**Scope:** Privy Add Funds provider routing only

## Problem

Flay previously opened Privy's normal card-onramp flow and allowed Privy to select an available provider for the user's region. The repository's own production evidence records that the working build used `@privy-io/react-auth` 3.42.0 and reached both Stripe's regional response and MoonPay's KYC flow. The dependency is now pinned to 3.44.0, and a later workaround added manual automatic/MoonPay choices through the legacy `useFundWallet` API. That workaround changed the working product behavior and can force or expose a provider choice instead of preserving Privy's automatic routing.

## Implementation

1. Pin `@privy-io/react-auth` to the previously verified 3.42.0 release in the web package and lockfile.
2. Use only Privy's supported `useFiatOnramp().fund(...)` path for card funding, bound to the authenticated embedded Solana wallet, Solana mainnet, and native USDC.
3. Remove the legacy `useFundWallet` MoonPay override, provider-selection parameter, Stripe-error retry logic, and manual MoonPay action.
4. Restore one `Continue to provider` action in the isolated checkout window. Privy's onramp owns regional eligibility, provider selection, payment, KYC, and fallback behavior.
5. Preserve the isolated checkout window so a stalled or closed provider modal cannot freeze the main Flay trading tab.
6. Preserve all existing destination checks, request-bound completion messages, balance refresh, disclosure copy, and non-fiat behavior.

## Acceptance criteria

1. The installed and locked Privy React version is exactly 3.42.0, matching Flay's recorded working provider-routing build.
2. The shipped Add Funds path calls `useFiatOnramp().fund(...)` once and contains no manual Stripe/MoonPay selection, no preferred-provider override, and no legacy `useFundWallet` funding call.
3. The checkout presents one provider-launch action and explains that Privy chooses an available provider for the user's region.
4. The funding destination remains the authenticated embedded Solana wallet on Solana mainnet with native USDC selected.
5. Payment, KYC, regional eligibility, provider quotes, and private payment data remain entirely inside Privy's provider flow.
6. Focused tests, full tests, TypeScript, production build, release audit, targeted browser audit, and local health pass without changing Convert, Futures, Stocks, Activity, wallet export, or gasless boundaries.

## Completion rule

Do not declare this restoration complete until all six criteria are compared with the actual repository and recorded in `PRIVY_AUTOMATIC_ONRAMP_ROUTING_RESTORE_AUDIT.md`. Live regional provider availability remains controlled by Privy and its providers; Flay must not claim that a specific provider is available until the provider flow shows it for that user and region.

# Flay Privy regional provider routing correction

**Status:** complete after authenticated founder acceptance  
**Date:** 2026-09-24  
**Scope:** production Add Funds provider selection

## Proven failure

The founder's production screenshot at `/storage/emulated/0/hackthon/jjhgb.jpg` shows that Privy's `useFiatOnramp` quote modal selected Stripe alone, returned `Stripe onramp is not available for USD in this region`, disabled Continue, and did not move to MoonPay. Downgrading to the previously used SDK version did not change this live provider response. Flay must therefore choose the appropriate Privy funding path before opening the provider modal.

## Implementation

1. Keep one Flay `Continue to provider` action and perform provider-path selection automatically before opening Privy.
2. Resolve the browser's current public-IP country and region through a bounded CORS request with a short timeout, validate only the country/region strings, cache the result for the checkout session, and never retain or log the IP address.
3. Use Privy's current `useFiatOnramp` quote flow in sandbox and in Stripe's documented onramp regions: the United States except New York, the European Union, and Serbia.
4. Outside those Stripe regions, or when region lookup fails, use Privy's Solana `useFundWallet` card flow with native USDC and MoonPay preferred. The selection remains automatic; Flay exposes no provider-choice button.
5. Bind both paths to the authenticated embedded Solana wallet. The Stripe path retains the exact Solana mainnet native-USDC destination, selected fiat, and amount. The MoonPay path uses Solana mainnet USDC and pre-fills an amount only for USD because the legacy funding API expresses the amount in the destination asset.
6. Do not fabricate a fiat submission result. The MoonPay funding flow has no authoritative submitted/confirmed result, so closing it produces an honest provider-exited state and triggers a wallet-balance refresh rather than a purchase-submitted claim.
7. Preserve the isolated checkout tab, payment/KYC custody boundary, request-bound cross-tab messages, and every non-fiat product boundary.

## Acceptance criteria

1. Bangladesh, Singapore, UAE, and unknown lookup results automatically select the MoonPay funding path; EU, Serbia, and supported US results select the Privy quote path; New York selects MoonPay.
2. One click launches the selected path with no Stripe/MoonPay buttons and no user-facing provider selector in Flay.
3. The reproduced Bangladesh route cannot enter the Stripe-only unavailable screen because Flay selects MoonPay before opening a Privy modal.
4. Both paths target the authenticated embedded Solana wallet and USDC; the quote path retains Solana mainnet CAIP-2 destination validation.
5. Region lookup is bounded, cached, contains no secret, stores no IP, and fails safely to the non-Stripe path without making checkout slow.
6. MoonPay exit never appears as `submitted` or `confirmed`; Flay tells the user to check the provider result and refresh the authoritative Solana balance.
7. Focused routing tests, full tests, TypeScript, production build, release audit, dependency audit, desktop/mobile browser audit, source scan, and local health pass.
8. `PRIVY_REGION_ROUTING_CORRECTION_AUDIT.md` compares all eight criteria with actual code and includes the founder's next authenticated live result before this correction is called fully complete.

## Completion rule

Complete and verify every autonomous item before requesting a founder retest. Do not declare this correction fully complete until an authenticated production click from the reproduced region opens the MoonPay path rather than the Stripe-unavailable screen. Provider KYC and purchase eligibility remain controlled by MoonPay and must not be represented as successful merely because its flow opens.

# Futures Privy authentication and SOL balance correction

**Status:** complete after founder-signed mainnet Phoenix deposit acceptance  
**Date:** 2026-09-24  
**Scope:** Phoenix session authentication and Futures wallet-balance clarity

## Proven failures

1. After successful Phoenix public onboarding, a collateral deposit fails with `invalid_privy_token`. Phoenix rejected both Flay's Privy identity token and a freshly issued Privy access token after sign-out, hard refresh, and sign-in. Phoenix's installed SDK also provides direct wallet-transaction authentication, which does not require Phoenix to trust Flay's Privy application token.
2. GMTrade correctly reports an account-rent shortfall, but the Futures interface shows only wallet USDC. The founder therefore cannot compare the error with the wallet's authoritative on-chain SOL balance and reasonably suspects a separate venue wallet.
3. The local server exited after Phoenix metadata fell back to the rate-limited public Solana RPC. Futures already has a bounded HTTP/API market-data path, so an optional background metadata fallback must not terminate the application process.

## Implementation

1. Keep the Privy identity token as the sole credential for authenticating Flay API requests and binding the embedded Solana wallet.
2. Authenticate Phoenix directly with the embedded wallet: request Phoenix's non-broadcastable wallet transaction challenge, inspect and bind it to the authenticated wallet, let Privy sign it, validate the returned signature against the exact challenge message, and exchange it through `loginWithWalletTransaction`.
3. Do not send any Privy identity or access token to Phoenix. Keep the identity token solely in Flay's authenticated request header and remove Phoenix access-token fields from request bodies, schemas, types, and UI auth state.
4. Keep the challenge one-time, short-lived, wallet-bound, size-bounded, and stored only in server memory. Keep the resulting Phoenix session short-lived, bounded, and server-only.
5. Return the embedded wallet's authoritative mainnet SOL balance with the Futures portfolio and show it beside wallet USDC in the collateral ledger.
6. Keep Phoenix collateral and GMTrade committed margin separate from wallet balances. Do not invent sponsorship or a separate venue wallet.
7. Return a clear wallet-authentication error if Phoenix rejects the signed challenge; do not tell the user to refresh Privy for a provider token that is no longer used.
8. Keep Phoenix live metadata on its API/WebSocket source and disable the SDK's optional metadata fallback to the configured public RPC. Explicit Flay RPC operations remain awaited and use the existing bounded fallback/error path.

## Acceptance criteria

1. Flay's authenticated Futures endpoints continue to reject a mismatched wallet using the verified identity token.
2. Phoenix login and challenge use the SDK's direct wallet-transaction endpoints; Phoenix receives no Privy identity or access token.
3. Phoenix auth request bodies accept only the authenticated wallet plus a bounded challenge ID and signed transaction where required; unknown token fields are rejected before provider access.
4. Tokens are absent from Phoenix request bodies, browser persistence, API responses, application logs, error details, and release artifacts.
5. The one-time wallet challenge is validated before signing and after signing, cannot be broadcast, and Phoenix sessions remain memory-only and bounded.
6. Futures shows the same wallet's live SOL and USDC balances; no UI suggests that Phoenix or GMTrade needs a separate SOL wallet.
7. A Phoenix metadata outage or public-RPC 429 degrades Futures data without terminating the Flay server.
8. Focused schema, API authorization, Phoenix authentication, portfolio, and UI tests pass, followed by TypeScript, production build, full tests, release audit, and local health.
9. The founder's authenticated retry reaches Phoenix's direct wallet challenge and no longer returns `invalid_privy_token`; the correction remains incomplete until that live result is recorded.

## Completion rule

Compare all nine criteria with actual code and current evidence in a completion audit. Do not call this correction complete until the founder retries Phoenix deposit with the same embedded wallet and Phoenix accepts the signed wallet challenge or returns a later transaction-specific result.

# GMTrade degraded-state recovery correction

**Status:** complete  
**Date:** 2026-09-25  
**Scope:** clear transient Futures venue warnings promptly after adapter recovery

## Proven failure

GMTrade's supervised sidecar can briefly reject a portfolio request during its one-second restart window. The server correctly returns cached venue data and an honest degraded warning, but the Futures UI waits its normal 60-second portfolio interval before checking again. The sidecar is already healthy while the stale warning remains visible.

## Implementation

1. Derive the portfolio refresh delay from the returned venue state: use the normal 60-second interval when healthy and a five-second recovery interval while any venue reports an error.
2. Return to the normal interval immediately after a successful portfolio refresh clears the venue error.
3. Add an explicit `Retry now` control to a degraded venue warning without clearing cached positions or recovery controls.
4. Add focused timing and rendering assertions, then run TypeScript, full tests, production build, release audit, browser audit, and live health.

## Acceptance criteria

1. A transient GMTrade portfolio error schedules another authenticated portfolio request within five seconds.
2. A successful retry replaces the degraded portfolio and removes the warning without requiring a page reload.
3. Healthy portfolios retain the 60-second background interval.
4. The warning exposes a usable `Retry now` action while cached data remains visible.
5. Phoenix and GMTrade position, order, and recovery state are not cleared during the retry.
6. Focused and full tests, TypeScript, production build, release audit, browser audit, and local health pass.

## Completion rule

Compare all six criteria with actual code and evidence before declaring this correction 100% complete.

# Futures mobile position visibility correction

**Status:** complete  
**Date:** 2026-09-25  
**Scope:** readable Futures portfolio rows on small screens and wallet-specific Phoenix readiness

## Proven failures

1. `/storage/emulated/0/hackthon/htvvf.jpg` shows `Positions 1`, `SOL-PERP`, `long`, and `phoenix`, but the fixed 700-pixel row pushes size, entry, PnL, and Manage off the right edge behind an unlabeled horizontal scroll area.
2. The same authenticated screen says `Phoenix: Wallet onboarding is required` because it renders anonymous registry readiness even though wallet-specific access and the live Phoenix position prove execution is active.

## Implementation

1. Give position, order, and history values explicit field labels so compact rows remain understandable without a desktop header.
2. Replace the small-screen fixed-width portfolio row with a responsive card grid that keeps market, side, venue, size, entry or price, PnL or status, and action visible inside the viewport.
3. Preserve the current compact desktop row layout and all existing position management actions.
4. Prefer authenticated wallet-specific Phoenix access for the readiness label and state. Use anonymous registry readiness only until wallet access is available.
5. Add focused rendering and responsive browser assertions, then run TypeScript, full tests, production build, release audit, browser audit, and live health.

## Acceptance criteria

1. On a 390-pixel viewport, every live-position value and the Manage button fit without horizontal portfolio scrolling.
2. Size, entry, and unrealized PnL have visible labels on the mobile card.
3. The active SOL-PERP long remains attributed to Phoenix and opens the existing management dialog.
4. An execution-eligible authenticated Phoenix account displays `Phoenix execution is active` with a ready state instead of anonymous onboarding guidance.
5. Desktop portfolio rows remain compact and functional.
6. Focused and full tests, TypeScript, production build, release audit, browser audit, and local health pass.

## Completion rule

Compare all six criteria with actual code and evidence before declaring this correction 100% complete.

# Futures RPC resilience and Phoenix entry correction

**Status:** complete  
**Date:** 2026-09-25  
**Scope:** truthful Futures balances, Phoenix entry availability, provider request pacing, and local runtime continuity

## Proven failures

1. The founder's long attempt in `/storage/emulated/0/hackthon/huvfd.jpg` did not submit. Flay displayed `Solana RPC: 429`, rendered unavailable wallet and Phoenix balances as zero, and excluded Phoenix with `Phoenix collateral state is unavailable`.
2. Phoenix's authoritative trader state still reports 1.020000 USDC collateral and no position, so the failed attempt did not lose or move funds.
3. `FuturesService.portfolio` loads wallet RPC balances and both venue portfolios in one `Promise.all`. A wallet RPC failure rejects the complete response even when Phoenix's independent HTTP state is healthy.
4. The Futures UI formats absent portfolio values as `0`, which misrepresents unavailable data as an authoritative zero balance.
5. Phoenix access and trader state are fetched repeatedly across portfolio and quote refreshes. Short successful-cache windows and no shared trader-state cache increase RPC/API pressure and make transient 429 responses block entry.
6. The local development process exited without a durable log, so the exact terminal exception was lost.
7. A live probe found that Phoenix reports trader collateral in atomic USDC units, while Flay converted that integer as a decimal UI amount and multiplied it by 1,000,000. This could overstate entry collateral even though final onchain simulation would still reject an underfunded transaction.
8. A slow GMTrade market/readiness response can delay the combined registry beyond Phoenix's market freshness window. Phoenix then rejects its route as stale even though it fetches a current order book immediately afterward.
9. After the successful founder entry, an unrelated background Solana RPC 429 surfaced as an unhandled rejection and terminated the development Node process. The supervisor restored service, but a routine provider throttle must not interrupt the app.

## Implementation

1. Load wallet balances independently from Phoenix and GMTrade portfolios. Return venue state when wallet RPC reads fail, with nullable wallet balances and an explicit wallet-balance error.
2. Cache the last authoritative wallet balance for a bounded period. Mark cached data as stale and retain its original timestamp; when no trusted value exists, return `null`, never a fabricated zero.
3. Render unavailable wallet or venue balances as `Unavailable` and retain the most recent successful portfolio in the browser during refresh failures. Never convert missing data into `0 USDC` or `0 SOL`.
4. Add bounded, wallet-keyed, in-flight-deduplicated caching for Phoenix trader state. Reuse a recent authoritative state across portfolio and quote refreshes, permit a bounded stale fallback only on retryable provider failure, expose degradation honestly, and fail closed when no trusted state exists.
5. Extend successful Phoenix access caching and preserve a bounded last-known successful access result when a refresh fails. Invalidate wallet-specific Phoenix state after onboarding, collateral, or trading submissions so confirmed changes can refresh promptly.
6. Reduce repeated Phoenix configuration/state requests without slowing the visible quote loop. Continue using current live order-book/mark data and revalidate price, route eligibility, transaction semantics, and simulation during review and execution.
7. Keep deposit, withdrawal, entry, and recovery safety checks strict. Wallet-dependent actions require an authoritative wallet balance; Phoenix entry may use authoritative Phoenix collateral independently of a wallet RPC balance.
8. Run the local development server under a persistent restart loop with a durable local log so an unexpected process exit is observable and automatically recovered.
9. Add focused tests for partial portfolio success, null-versus-zero rendering, bounded caches, stale fallback, cache invalidation, and entry behavior, followed by TypeScript, production build, full tests, release audit, browser audit, live health, and an authenticated founder retry.
10. Preserve Phoenix's provider-reported atomic collateral units exactly in portfolio and route eligibility calculations; convert only fields explicitly documented as UI decimal values.
11. Evaluate Phoenix quote freshness from the order book actually used for that quote, so a slow peer venue cannot make current Phoenix liquidity appear stale.
12. Contain known background Solana RPC throttling rejections at the process boundary, record a non-secret diagnostic, and continue serving. Preserve fail-fast restart behavior for unknown programming failures.

## Acceptance criteria

1. A wallet RPC 429 cannot hide a healthy Phoenix collateral balance or positions in the same portfolio response.
2. Missing wallet or venue values display as unavailable; only an authoritative numeric zero displays as zero.
3. A recent successful Phoenix trader state is shared across portfolio and quote requests, provider request counts are bounded, and concurrent requests are deduplicated.
4. Retryable provider failure may use a clearly degraded bounded cache; expired or absent state remains ineligible and cannot produce a fake executable route.
5. Phoenix writes invalidate relevant cached state, and post-transaction refresh can observe new collateral, orders, and positions.
6. The accepted 1.020000 USDC Phoenix collateral can produce a Phoenix entry route even when the independent wallet RPC read is unavailable.
7. Final transaction preparation still refreshes route constraints, validates the exact provider transaction, simulates the exact message, and requires the embedded wallet signature.
8. The persistent local server recovers from an unexpected process exit and retains a useful non-secret log.
9. Focused and full tests, TypeScript, production build, release audit, browser audit, and local health pass.
10. The founder's authenticated long retry reaches transaction review or an honest later transaction-specific result without false zero balances or `PHOENIX_STATE_UNAVAILABLE`; this correction remains incomplete until that live result is recorded.
11. Phoenix's authoritative `1020000` collateral value is represented as 1.020000 USDC and never inflated to `1020000000000` atomic units.
12. A slow or degraded GMTrade response cannot make a current Phoenix order-book quote ineligible as stale.
13. A known background Solana RPC 429 is logged without terminating the server; an unknown unhandled rejection is still fatal so the supervisor can restart cleanly.

## Completion rule

Compare all thirteen criteria with actual code and evidence in a completion audit. Do not call this correction complete until the founder retries the Phoenix long from the same embedded wallet, the live result is recorded, and the post-entry RPC crash hardening passes.

# Flay Privy local authentication origin fix

**Status:** cancelled after founder confirmed Google/email login works; no implementation was made  
**Date:** 2026-09-24  
**Scope:** local Google/email authentication and isolated checkout origin

## Proven failure

The screenshot at `/storage/emulated/0/hackthon/juggr.jpg` was initially interpreted as an unresponsive Google/email action. The founder then confirmed that login works and there is no authentication problem. This proposed change is cancelled and must not be implemented.

## Implementation

1. Before React or Privy mounts, detect browser pages opened on `127.0.0.1` and replace that URL with the equivalent `localhost` URL.
2. Preserve protocol, port, path, checkout query parameters, and hash so main-app and isolated-checkout navigation continue at the same location.
3. Leave `localhost`, deployed hosts, IPv6, and other origins unchanged.
4. Keep API health reachable locally and keep the persistent Flay development server running.
5. Add focused tests for main-page and checkout URL canonicalization and update browser verification to prove a `127.0.0.1` entry reaches `localhost` before authentication UI is used.

## Acceptance criteria

1. Opening `http://127.0.0.1:5173` automatically lands on `http://localhost:5173` before `PrivyProvider` mounts.
2. An isolated checkout opened with fiat, amount, and request parameters keeps every parameter after canonicalization.
3. The Google/email action is rendered on the canonical Privy origin and the incorrect-origin setup failure is absent once Privy becomes ready.
4. Production/deployed URLs are never rewritten.
5. Focused tests, full tests, TypeScript, production build, release audit, targeted browser audit, full browser regression, and local health pass.
6. `PRIVY_LOCAL_AUTH_ORIGIN_FIX_AUDIT.md` maps every criterion to final code and records the founder's authenticated login retest before this fix is called fully complete.

## Completion rule

Complete all autonomous implementation and verification before requesting a founder retest. Do not call the fix fully complete until the founder confirms that the canonical local page opens Privy's Google/email authentication UI.

# Flay xStocks catalog recovery fix

**Status:** complete — see `XSTOCKS_CATALOG_RECOVERY_FIX_AUDIT.md`  
**Date:** 2026-09-25  
**Scope:** official xStocks catalog availability and Stocks unavailable state

## Problem

The Stocks directory can remain empty after a local server restart even though the official xStocks API is available. The server fetches broad catalog pages in parallel with a generic ten-second timeout and automatic retry. When xStocks is temporarily slow, the requests time out before a catalog cache exists, and the browser shows `Connecting to official data` plus an unhelpful `Choose an xStock` detail panel.

## Implementation

1. Request the official xStocks catalog with the documented Solana network filter and an explicit bounded page size, while retaining bounded schema validation, pagination, canonical Solana-mint checks, and the existing official-data-only trust boundary.
2. Load one official, server-validated AAPLx record first so the Stocks screen has a usable authentic asset while the full directory refreshes in the background. Label that partial directory honestly and replace it with the complete bounded catalog only after every page succeeds.
3. Fetch the full catalog in bounded background page batches so a provider pause does not create a large concurrent burst. Retry incomplete directory work only when the browser requests the existing partial cache; give each background catalog request a bounded catalog-specific timeout without multiplying an individual request through an automatic second attempt. The initial asset, detail, multiplier, and reference-price requests retain the short generic timeout.
4. Preserve live and bounded stale-cache behavior. Never create local stock records, prices, mints, routes, balances, or receipts when official data is unavailable.
5. Make the Stocks provider label and both panels report catalog failure clearly, retain a usable refresh action, and avoid implying that the user merely failed to choose an asset.
6. Add deterministic tests for the exact catalog request contract, initial official asset, background directory behavior, and unavailable-state interface, then run focused tests, the full test suite, production build, release audit, and a live local API check.

## Acceptance criteria

1. Catalog URLs contain `network=Solana`, `page`, and a bounded `pageSize`; only validated official Solana deployments enter the catalog.
2. A cold server returns a validated official AAPLx record promptly and labels the directory as still loading; it does not invent an asset, mint, price, balance, route, or trade.
3. A temporarily slow complete-catalog request receives one bounded catalog-specific attempt in a small background page batch, then retries safely on a later partial-cache request rather than two generic timeout windows or a large concurrent burst; all existing page, byte, asset, and malformed-response limits remain enforced.
4. A live, partial, complete, or permitted stale official catalog remains the sole source of selectable symbols; an absent catalog cannot enable stock detail, quote, review, or execution.
5. A failed catalog visibly says official data is unavailable and supplies `Retry catalog` from both the directory and the empty trade panel.
6. Focused and full tests, TypeScript/production build, release audit, and a live local `/api/stocks` request pass. The completion audit compares every criterion with final code before any completion claim.

## Completion rule

Do not declare this correction complete until every acceptance criterion is mapped to code and verification evidence in `XSTOCKS_CATALOG_RECOVERY_FIX_AUDIT.md`. A provider outage must remain visible as an unavailable state rather than being hidden by sample or cached data outside the permitted stale window.

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

# Flay xStocks asset-detail reliability fix

**Status:** complete — see `XSTOCKS_DETAIL_RELIABILITY_FIX_AUDIT.md`  
**Date:** 2026-09-26  
**Scope:** prevent the Stocks asset-detail screen from waiting indefinitely when xStocks reference prices are slow

## Observed fault

The Stocks page can remain on `Verifying official asset` because `loadDetail` treats the xStocks issuer reference-price endpoint as mandatory. On 2026-09-26, the canonical AAPLx asset and multiplier endpoints returned normally, while `/price-data` timed out. The existing generic retry caused the detail API to take about twenty seconds before it could return an error.

## Implementation

1. Preserve strict canonical asset, Solana mint, multiplier, Token-2022, and Jupiter-route verification. A failure of any execution-critical check must still fail closed.
2. Treat the issuer reference price as optional display data. Give it one short, non-retried attempt; use the separately reviewed live-price fallback when it is available, otherwise return `referencePrice: null` and show `Unavailable` rather than inventing a price.
3. Give execution-critical detail calls one bounded, non-retried timeout and limit background list reference-price probes, avoiding a price-request burst that competes with the selected asset.
4. Add a browser-side detail request deadline. It must cancel the pending request, stop the spinner, explain the timeout, and leave the existing Retry action available.
5. Add tests for the optional-price timeout path and visible retryable timeout state. Run focused tests, the full quality check, release audit, browser audit, and a live local AAPLx detail request.

## Acceptance criteria

1. With an unavailable price-data endpoint but valid canonical asset, multiplier, and mint, `/api/stocks/AAPLx` remains usable with a separately verified live market reference when available, or null reference fields when neither verified price source responds.
2. A failed asset, multiplier, mint, or onchain Token-2022 validation cannot produce a tradable stock asset or Jupiter quote.
3. Each detail request uses bounded no-retry provider attempts; list pricing makes only a small bounded number of optional price requests.
4. The browser cannot remain on `Verifying official asset` indefinitely. It reaches a retryable error state within the client deadline.
5. No price, mint, balance, route, quote, or receipt is synthesized when a provider value is unavailable.
6. The completion audit maps all acceptance criteria to final code and successful verification before the fix is declared complete.

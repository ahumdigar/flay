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

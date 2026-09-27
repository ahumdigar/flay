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

# Flay Futures Aggregator: real hackathon release

**Status:** active implementation scope  
**Budget constraint:** no more than USD 10 of founder-funded on-chain test capital  
**Deployment rule:** Flay deploys no custom Solana program  
**Venues:** Phoenix priority 1; GMTrade priority 2

## Product definition

Flay Futures is a self-custodial perpetual-futures aggregator inside the existing React and Express application. It compares native Phoenix and GMTrade execution for the same economic request, recommends the lowest immediate eligible cost, permits a manual venue override, and then fixes that venue for review, signing, execution, and the full position lifecycle.

The Privy embedded Solana wallet signs every transaction. Flay never receives or stores the wallet private key. Venue programs remain the source of truth for collateral, orders, positions, funding, PnL, and liquidation state. Flay charges no trading or builder fee.

### Locked launch decisions

- Phoenix is integration priority 1 and GMTrade is priority 2. Flash Trade and Jupiter Futures are excluded.
- Launch supports isolated positions only, USDC collateral only, and a Flay leverage ceiling of 10x.
- The market registry is the live union of active Phoenix and GMTrade crypto markets, initially prioritizing SOL-PERP, BTC-PERP, and ETH-PERP. Flay compares both routes where both venues expose a market and preserves a single-venue route when its peer is unavailable. RWA, equity, meme, and xStock markets remain outside this block.
- Market and limit entry, cancellation, full close, partial reduce, collateral recovery, and TP/SL are in scope.
- Flay automatically recommends an eligible venue and permits manual Phoenix or GMTrade selection. It never splits a position.
- TradingView Lightweight Charts renders Phoenix external-reference candles. The candle series does not change when route selection changes.
- Futures orders, collateral, and positions remain public on Solana. MagicBlock PER does not make third-party venue trades private.
- Phoenix public data is available before wallet setup. Live Phoenix execution remains ineligible until the wallet completes Phoenix's official public onboarding transaction.

## Repository and governance

1. This file is the binding active plan.
2. AGENTS.md and agent.md must name this file as the active scope while preserving the Convert plan and incomplete Convert completion audit.
3. FUTURES_COMPLETION_AUDIT.md must map every numbered acceptance criterion to implementation and direct evidence before any completion claim.
4. No fake quote, position, order, balance, candle, transaction, fill, or PnL may appear in the shipped path.
5. Provider unavailability disables only the affected new action. Existing close, reduce, cancel, and collateral-recovery paths remain reachable.
6. No completion claim is permitted until the founder-signed Phoenix and GMTrade lifecycles pass with direct venue evidence.

## Venue adapters

### Phoenix

Use a pinned @ellipsis-labs/rise release for public exchange metadata, active markets, L2 orderbooks, mark prices, funding, account state, instructions, and websocket support.

- Read public Phoenix market data without requiring onboarding.
- Check wallet onboarding capabilities, trader registration, and collateral state independently.
- Keep Phoenix wallet-auth JWT and refresh credentials in short-lived server memory and out of browser responses and logs.
- Use Phoenix's official public no-referral onboarding endpoints to build registration/delegated-onboarding instructions and submit the wallet-signed transaction for the required venue co-signature.
- Validate the fee payer, trader PDA, max positions, provider signer, registration decision, programs, accounts, and instruction semantics before asking the wallet to sign. Referral codes are optional at Phoenix and are not required by Flay.
- Use portfolio index 0 and allocate one isolated subaccount per position.
- Build native registration, USDC deposit and withdrawal, market and limit entry, cancel, reduce, close, and conditional-order instructions.
- Do not use Phoenix Flight and do not add a Phoenix builder fee.
- Before onboarding, return live public quotes with executionEligible=false and reason=PHOENIX_ONBOARDING_REQUIRED. Such a route cannot become the automatic winner.

### GMTrade

Use a Rust adapter service pinned to the audited gmsol-sdk 0.10 release and a locked source revision. The published npm package is not an implementation dependency.

- The service communicates with Express using bounded JSON Lines over stdin and stdout and exposes no public network port.
- Commands are health, markets, quote, portfolio, and prepare_action.
- It accepts only a wallet public key. It never receives a wallet private key, signs as the user, or submits a transaction.
- Build with a non-signing wallet abstraction and return unsigned versioned transactions for Privy.
- Use direct USDC collateral paths only. Multi-market collateral swap paths are disabled.
- Pin official mainnet program IDs, market configuration, address lookup tables, and the reviewed deployment baseline.
- Node supervises the process, enforces request timeouts and output bounds, reports readiness, and restarts it after a crash.
- If the official SDK cannot produce a transaction that the Privy wallet can sign, GMTrade is unavailable; no substitute transaction is fabricated.

## Normalized domain and APIs

All monetary values use integer strings. USDC uses six-decimal atomic values. Comparable USD values use micro-USD. Leverage uses basis points where 10000 equals 1x. Base size uses an atomic integer plus explicit market decimals. Provider-native precision remains bound to the server-side prepared record.

Primary shared types:

- FuturesVenue = phoenix | gmtrade
- FuturesOrderType = market | limit
- FuturesSide = long | short
- FuturesMarket
- FuturesIntent
- FuturesRouteQuote
- FuturesPreparedStep
- FuturesExecution
- FuturesPosition
- FuturesOrder
- FuturesPortfolio
- ReferenceCandle

Endpoints:

| Endpoint | Contract |
| --- | --- |
| GET /api/futures/markets | Active normalized market registry and per-venue readiness |
| GET /api/futures/candles | Phoenix external-reference OHLC data with source and timestamp |
| POST /api/futures/quotes | Identity-bound, wallet-specific route comparison |
| GET /api/futures/portfolio | Venue-separated collateral, positions, orders, and history |
| GET /api/futures/phoenix/access | Public onboarding-capability and trader-account state |
| POST /api/futures/phoenix/auth/* | Wallet challenge and short-lived authenticated trading session |
| POST /api/futures/prepare | Fresh exact setup, entry, cancel, close, reduce, TP/SL, or withdrawal preparation |
| POST /api/futures/execute | Exact signed-message validation, simulation, and idempotent submission |
| GET /api/futures/execution/:id | Reconciled submitted, resting, partial, filled, cancelled, or failed state |

Authenticated endpoints bind the Privy identity to the requested wallet. Quote and prepared records are short-lived and bound to wallet, venue, market, intent, and current venue state.

## Fair routing

Compare only the same market, direction, isolated collateral, effective notional, and order type.

For market orders, immediate execution cost contains adverse execution price against the stable reference, opening fee, keeper or execution fee, and nonrecoverable network cost. Account rent is disclosed separately. Funding and borrowing are displayed but excluded from ranking because holding time is unknown.

For limit orders, require support for the exact limit and collateral request, compare currently known opening and execution costs, and disclose that placement does not guarantee a fill.

Rules:

1. Exclude stale, inaccessible, capacity-limited, unsupported, or non-simulatable candidates.
2. Never recommend Phoenix while the wallet lacks confirmed onboarding capabilities.
3. Recommend the lowest immediate-cost eligible route.
4. Break negligible ties by verified build reliability, then Phoenix priority.
5. Label a sole candidate Only available route instead of Best.
6. If comparable costs are unavailable, show the separate values and require manual selection.
7. Refresh every candidate before review. Any material venue, price, fee, setup, or liquidation change requires a new review.
8. Once reviewed, never reroute to another venue silently.
9. A limit order stays on its placement venue when triggered.
10. Close, reduce, cancel, TP/SL, and recovery always target the original venue and native identifier.

## Interface

Add Futures to desktop and mobile navigation without regressing Convert, Activity, Wallet, or PER.

Desktop contains a market header, stable reference chart, venue price chips, long/short and market/limit ticket, collateral and leverage inputs, route comparison, exact review, and Positions, Orders, and History panels. Mobile uses the same information in a stacked layout with a sticky review action.

The ticket shows:

- live market and market status;
- Long or Short;
- Market or Limit;
- USDC collateral;
- leverage from 1x through 10x;
- resulting notional and base size;
- limit price when applicable;
- acceptable-price or slippage bound;
- Auto, Phoenix, or GMTrade route selection;
- entry estimate, price impact, opening and execution fees;
- current funding and borrowing;
- isolated liquidation estimate and account setup requirements.

The chart supports 1m, 5m, 15m, 1h, 4h, and 1d intervals. It uses Phoenix external-reference OHLC fields, displays the reported external source and freshness, keeps venue marks separate, preserves TradingView attribution, and shows a truthful unavailable state instead of invented candles.

Phoenix before onboarding displays Phoenix public onboarding is required and links to the official registration documentation. Public Phoenix data remains visible, and the user can review the public onboarding transaction before trading.

Futures state and components live under src/futures so App.tsx does not become another monolith.

## Transaction and position lifecycle

Every setup or trading transaction receives its own exact review and wallet signature.

- Phoenix: complete the official public onboarding transaction, which includes registration when needed, deposit USDC in a separate reviewed transaction, then re-quote before opening an isolated position.
- GMTrade: prepare user and token accounts only when required and use the direct USDC native order flow.
- Do not hide setup and trade behind an opaque multi-transaction approval.
- Display wallet USDC, Phoenix collateral, and GMTrade committed collateral separately.
- Market submission may be submitted before a venue confirms a fill.
- Limit submission becomes resting only after venue state confirms the order.
- Track partial fills, remaining size, and effective average entry.
- Build authoritative portfolio state from venue and on-chain state after reload or server restart.
- Store submitted signatures locally only as a continuity aid.
- Full close is reduce-only. Partial reduce cannot exceed live size.
- TP/SL trigger and expected execution prices are distinct.
- After a close or reduction, detect and expose orphaned conditionals.
- Withdrawal cannot consume margin required by positions or resting orders.

## Transaction security

Before Privy signs, validate:

- fee payer and required signer set;
- allowlisted venue, system, compute, token, associated-token, oracle, and memo programs;
- resolved and allowlisted address lookup tables;
- wallet-owned collateral account and receiver;
- USDC mint and token program;
- exact venue, market, direction, isolated account, collateral, size, leverage result, and order kind;
- acceptable or limit price and execution-fee ceiling;
- transaction blockhash, lifetime, instruction count, and message fingerprint;
- absence of unexpected recipients, programs, writable accounts, and signers.

After signing, compare the message bytes with the reviewed bytes, verify the wallet Ed25519 signature, simulate or provider-submit it once with an idempotency key, and reconcile venue state. Signed bytes, request bodies, venue sessions, and identity tokens are never logged.

New entries are disabled when data is stale, the GMTrade adapter is unhealthy, a pinned program deployment changes, simulation fails, or a market pauses. Recovery actions remain available.

## Operations

- Extend health output with Phoenix public data, Phoenix execution onboarding state, GMTrade adapter, candles, RPC, and simulation readiness.
- Coalesce identical market and candle requests and cache only within freshness bounds.
- Refresh visible quotes every three seconds; pause while review or signing is active; use bounded exponential backoff after rate limiting.
- Use Phoenix websocket data where available and repair sequence gaps with HTTP snapshots.
- Poll identity-bound portfolio state after submission and at a slower interval otherwise.
- Record provider latency, stale data, build success, simulation failure, submit result, and reconciliation lag without wallet-identifying logs.
- Circuit-break new entries after repeated invalid provider transactions or program-baseline changes.

## Release acceptance

Futures is ready only when all applicable criteria pass against live infrastructure:

1. The existing Privy identity returns the same exportable Solana wallet and every authenticated Futures endpoint rejects a different wallet.
2. Live market registry maps the same economic instrument to distinct Phoenix and GMTrade identifiers, precision, risk limits, and active status.
3. Stable Phoenix external-reference candles render at all supported intervals, stay unchanged during venue selection, show source/freshness, and fail honestly.
4. Both adapters return normalized quotes for the same isolated USDC request without fake data.
5. Routing handles long, short, market, limit, one-route, no-route, stale-route, and near-tie cases exactly as specified.
6. Phoenix before confirmed public onboarding stays visible as public data but is never executable or recommended.
7. GMTrade builds a real direct-USDC unsigned transaction through the pinned Rust SDK and Flay validates every reviewed field.
8. Phoenix builds real native unsigned setup and trading transactions through Rise; signed execution remains required before completion.
9. Fresh review prevents silent venue changes and detects any material quote or risk change.
10. Altered messages, unexpected programs/accounts/signers, wrong markets, mints, directions, amounts, prices, fees, lookup tables, and expired transactions are rejected.
11. Market entry reconciles submitted, partial, filled, and failed states from the venue.
12. Limit entry can be observed and cancelled, with collateral recovery confirmed.
13. Full close and partial reduce target the original venue and produce correct remaining position state.
14. TP/SL can be created, observed, cancelled, and checked for orphaning after position changes.
15. Wallet, Phoenix, and GMTrade collateral remain visually and technically separate; unsafe withdrawal is blocked.
16. Provider outage disables new affected entries without hiding or disabling valid cancel, reduce, close, and recovery actions.
17. Desktop and mobile layouts, keyboard review flow, rejected signature, stale blockhash, rate limit, RPC outage, and wallet modal recovery pass.
18. No secret, signed transaction, session token, fake trading path, mock value, unfinished placeholder, or in-scope disabled control ships.
19. Convert, Activity, Wallet, and PER regression checks pass.
20. Under the USD 10 ceiling, a GMTrade SOL-PERP market position is opened and fully closed, a limit order is created and cancelled, collateral recovery is verified, and evidence is recorded.
21. The wallet completes signed Phoenix public onboarding, the trader account is registered and funded, a small isolated market position is opened/closed, a limit is created/cancelled, remaining collateral is withdrawn, and evidence is recorded.
22. FUTURES_COMPLETION_AUDIT.md maps every criterion to implementation files, deterministic tests, live tests, and signed Explorer/venue evidence.

If a venue minimum or required rent exceeds USD 10, record it as a blocker and do not spend more or claim completion.

## Verification commands

The final implementation must provide and pass:

- TypeScript type check and production Vite build.
- Rust format check, Clippy with warnings denied, unit tests, and release build.
- Deterministic frontend, API, routing, adapter, lifecycle, and adversarial transaction tests.
- Opt-in live Phoenix public-data and unsigned-builder tests.
- Opt-in live GMTrade state, unsigned-builder, and simulation tests.
- Existing Convert and MagicBlock live provider tests.
- Production dependency and Rust advisory scans.
- Secret and browser-bundle scans.
- Shipped-source scan for TODO, FIXME, mocks, illustrative data, placeholders, and unreachable recovery actions.
- Browser desktop/mobile acceptance and founder-controlled signed mainnet flows.

## Primary references

- Phoenix documentation: https://docs.phoenix.trade/
- Phoenix Rise SDK: https://docs.phoenix.trade/sdk/rise
- Phoenix API index: https://docs.phoenix.trade/llms.txt
- GMX-Solana SDK: https://github.com/gmsol-labs/gmx-solana
- GMTrade documentation: https://docs.gmtrade.xyz/
- TradingView Lightweight Charts: https://tradingview.github.io/lightweight-charts/docs

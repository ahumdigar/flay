# Futures Privy authentication and SOL balance correction audit

**Date:** 2026-09-25  
**Result:** complete; founder-signed mainnet Phoenix deposit accepted

## Plan-versus-code comparison

| # | Result | Evidence |
| ---: | --- | --- |
| 1 | Pass | `server/auth.ts` continues to verify the identity token and bind the embedded Solana address. `server/futures/api-auth.test.ts` proves every authenticated Futures route, including both Phoenix auth routes, rejects a different wallet. |
| 2 | Pass | `FuturesPage.tsx` requests a wallet-only challenge and signs it with the embedded Privy wallet. `api.ts`, `transaction-service.ts`, and `phoenix-transactions.ts` call Phoenix's `getWalletTransactionChallenge` and `loginWithWalletTransaction`; no Privy token is forwarded to Phoenix. A live generated-wallet probe completed the challenge, signed it, and received an authenticated Phoenix session. |
| 3 | Pass | `schemas.ts` accepts only `wallet` for the challenge and only the optional exact proof pair for login. Both schemas are strict. Focused tests prove `privyAccessToken` is rejected as an unknown request field and malformed proof pairs fail before provider access. |
| 4 | Pass | `FlayAuth` and `PrivyRoot.tsx` no longer expose `getAccessToken`; the browser and server Phoenix paths contain no provider-token field. Source inspection finds the old name only in negative schema tests. The final release source/browser scan passes across 246 bundle files. |
| 5 | Pass | `PhoenixChallengeStore` keeps bounded, expiring, wallet-bound, one-use challenges in memory. The validator requires Phoenix's versioned login Memo, exact nonce, exact wallet, sole expected signer and fee payer, and a valid timestamp before Privy signs; it then checks the exact message and cryptographic signature. The challenge uses Phoenix's documented deterministic non-recent blockhash and is never submitted. Focused lifecycle and mutation tests pass, and the live direct-auth probe succeeded. |
| 6 | Pass | `FuturesPortfolio` now includes `walletSolLamports` from the same authoritative token/RPC balance response as wallet USDC. The Futures ledger labels the same embedded wallet with both balances. The live wallet `FexVXRLxhSgV2yW2VSJ54WQ3T58KQUr2Kikvr43nLMc7` returned 0.002349655 SOL and 1.433001 USDC, matching the screenshot's USDC and proving there is no separate venue wallet. |
| 7 | Pass | `phoenix-adapter.ts` keeps live metadata on Phoenix API/WebSocket and disables Rise's optional metadata fallback to the public Solana RPC. After the accepted deposit, Phoenix's candles endpoint rate-limited public reads with HTTP 429; `/api/health` stayed responsive, reported `degraded`, preserved a live Phoenix API stream, and the persistent tmux server remained alive. Explicit Flay RPC checks remain bounded in `withRpcFallback`. |
| 8 | Pass | Final focused checks pass (15 tests); the full suite passes (41 files plus 4 skipped, 231 tests plus 8 skipped); TypeScript and the production build pass; desktop/mobile browser audit passes with zero runtime exceptions; release audit passes across 246 bundle files. Local health returned `ok` before the live retry and remained responsive with truthful provider degradation after Phoenix rate-limited public reads. |
| 9 | Pass | On 2026-09-25 the founder retried the Phoenix deposit from the embedded wallet. Flay recorded one successful Phoenix build, two successful simulations, and one successful submission with no entry-circuit failure. Phoenix's authoritative trader state for `FexVXRLxhSgV2yW2VSJ54WQ3T58KQUr2Kikvr43nLMc7`, PDA index 0, reports subaccount 0 collateral `1020000` and a new `lastDepositSlot` of `450105503`: 1.020000 USDC was accepted. No `invalid_privy_token` failure occurred. |

## Current wallet evidence

- Wallet: `FexVXRLxhSgV2yW2VSJ54WQ3T58KQUr2Kikvr43nLMc7`.
- Mainnet balance observed after the screenshots: 0.002349655 SOL and 1.433001 USDC.
- GMTrade's simulation reported 0.00410464 SOL account rent with 0.000786215 SOL left after transaction fees, requiring at least 0.003318425 additional SOL plus a buffer.
- This is a one-time account-creation/rent requirement for the same Privy wallet, not a second GMTrade account that must be funded separately.

## Remaining acceptance

All nine criteria pass. The founder-signed mainnet deposit advanced through direct wallet authentication, transaction build, simulation, submission, and authoritative Phoenix collateral state. This correction is complete.

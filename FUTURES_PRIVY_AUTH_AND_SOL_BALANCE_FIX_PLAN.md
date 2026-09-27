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

# MagicBlock live-readiness fix plan

> Superseded on 2026-09-23 by [MagicBlock real authorization plan](MAGICBLOCK_REAL_AUTHORIZATION_PLAN.md). The fail-closed controls remain active, while Flay now authorizes through MagicBlock's attested mainnet TEE instead of the mock-backed Payments login route.

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

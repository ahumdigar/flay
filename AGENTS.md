# Flay build rules

These rules apply to every Flay implementation session.

## Active scope

1. Privy fiat onramp is implemented under `HACKATHON_PRIVY_FIAT_ONRAMP_PLAN.md`. The regional-routing correction is complete under `PRIVY_REGION_ROUTING_CORRECTION_PLAN.md`, including authenticated founder acceptance after MoonPay was enabled for the Privy app. The proposed local-auth origin change was cancelled after the founder confirmed Google/email login works. The failed SDK-only restoration and manual MoonPay workaround are superseded; preserve their plans and audits only as historical evidence. Alchemy Pay work remains paused while waiting for sandbox credentials and commercial terms; preserve its exact checkpoint in `ALCHEMY_PAY_WAITING_STATUS.md`, its plan, and implementation as dormant fallback history.
2. Jupiter Convert sponsorship is implemented under `HACKATHON_MINIMUM_GASLESS_PLAN.md`. Gasless USDC send is implemented under `HACKATHON_GASLESS_USDC_SEND_PLAN.md`. Privy-sponsored Raydium and Orca Convert is the active gasless block under `HACKATHON_RAYDIUM_ORCA_GASLESS_PLAN.md`, with the active exact-affordability fix in `HACKATHON_EXACT_SOL_AFFORDABILITY_FIX_PLAN.md`; all four plans must remain embedded in `agent.md`.
3. The broad platform gasless plan in `HACKATHON_GASLESS_PLAN.md` is preserved for later and remains superseded. Do not add a Flay sponsor wallet, Kora, sponsor key, or gasless support to Futures, MagicBlock, Trigger, fiat, native-SOL wrapping, missing token accounts, or arbitrary transfers. Raydium and Orca sponsorship is limited to the exact eligibility boundary in the active plan.
4. Preserve the Convert, Futures, Alchemy Pay, and Gasless plans and completion audits as truthful records, including founder-signed checks that remain open. The Phoenix authentication correction in `FUTURES_PRIVY_AUTH_AND_SOL_BALANCE_FIX_PLAN.md` is complete after a 1.020000 USDC mainnet deposit. The active Futures correction is `FUTURES_RPC_RESILIENCE_AND_ENTRY_FIX_PLAN.md`: prevent wallet RPC 429 responses from hiding Phoenix collateral, bound Phoenix state requests, and require a founder-signed long retry before completion.
5. xStocks is the active product block under `HACKATHON_XSTOCKS_PLAN.md`, with execution evidence under `XSTOCKS_EXECUTABLE_ROUTE_FIX_PLAN.md` and completed directory-visibility evidence under `STOCK_DIRECTORY_VISIBILITY_FIX_AUDIT.md`. It uses the official public xStocks catalog and Jupiter-only execution. Memes and off-ramp remain later blocks. MagicBlock real authorization remains deferred and incomplete until its provider and founder-wallet acceptance gates pass.
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

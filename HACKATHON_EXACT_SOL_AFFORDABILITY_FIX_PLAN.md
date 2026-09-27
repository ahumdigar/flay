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

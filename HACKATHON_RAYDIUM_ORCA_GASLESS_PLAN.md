# Flay Raydium and Orca gasless Convert plan

**Status:** active implementation plan  
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

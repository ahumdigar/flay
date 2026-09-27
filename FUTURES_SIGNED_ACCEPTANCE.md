# Futures founder-signed mainnet acceptance

**Status:** Pending founder wallet signatures  
**Capital ledger:** USD 0 spent by this acceptance run  
**Hard ceiling:** USD 10 total founder-funded capital across GMTrade and Phoenix acceptance

This record exists because deterministic tests and unsigned simulations cannot prove the venue lifecycle after a real wallet signature. Never paste a private key, identity token, or signed transaction payload here. Record public wallet addresses and transaction signatures only if the founder chooses to retain them as release evidence.

## Budget guard

Before every signature, copy the exact USDC collateral, execution fee, Solana network fee, and new-account rent shown by Flay's review. Add the nonrecoverable fees and rent to the ledger below. Stop before signing if the projected founder-funded capital committed or spent would exceed USD 10. If a venue minimum or required rent causes that condition, record the displayed values as a blocker and do not continue.

| Item | Projected USD | Actual USD | Evidence |
| --- | ---: | ---: | --- |
| GMTrade market open and close | Pending | Pending | Pending |
| GMTrade limit create and cancel | Pending | Pending | Pending |
| GMTrade collateral recovery after cancel | Pending | Pending | Pending |
| Phoenix public onboarding, register, and funding | Pending | Pending | Founder signatures pending |
| Phoenix market open and close | Pending | Pending | Founder signatures pending |
| Phoenix limit create and cancel | Pending | Pending | Founder signatures pending |
| Phoenix remaining-collateral withdrawal | Pending | Pending | Founder signature pending |
| **Total** | **Pending** | **USD 0** | **No Futures signature submitted yet** |

## GMTrade criterion 20

The live unsigned test proves that 1 USDC collateral at 2x on SOL-PERP currently quotes, builds through `gmsol-sdk` 0.10.0, passes Flay's semantic/account validation, and simulates on mainnet. The following founder-controlled checks still require the Privy wallet:

| Check | Required observation | Signature / venue evidence | Status |
| --- | --- | --- | --- |
| Wallet continuity | The authenticated Futures wallet equals the exportable Privy Solana wallet used by Convert | Public wallet or redacted note | Pending |
| Market open | Review GMTrade, SOL-PERP, isolated, direct USDC, market, collateral and fees; sign; wait for venue position | Explorer signature plus Flay position state | Pending |
| Full close | Use Manage on the original GMTrade position; sign reduce-only close; wait for zero remaining size | Explorer signature plus before/after size | Pending |
| Limit create | Review a small SOL-PERP limit on GMTrade; sign; wait for resting native order | Explorer signature plus native order ID | Pending |
| Limit cancel | Cancel that exact original-venue order; wait until it disappears | Explorer signature plus cancellation state | Pending |
| Recovery | Confirm committed GMTrade collateral is released after cancellation and wallet/venue balances remain separately labelled | Before/after atomic balances | Pending |

A rejected Privy signature must leave the exact review usable or allow a clean close and rebuild. Do that rejection check before the funded market open; it costs nothing.

## Phoenix criteria 8 and 21

Phoenix public markets, marks, candles, quotes, onboarding gate, Rise builders, and instruction validation are implemented. The live suite has built, validated, and simulated Phoenix's official public no-referral onboarding transaction. Signed acceptance can proceed with the founder-controlled Privy wallet.

| Check | Required observation | Signature / venue evidence | Status |
| --- | --- | --- | --- |
| Public onboarding | Exact no-referral transaction reviewed and signed; portfolio 0 registration and capabilities indexed | Explorer/Phoenix state | Pending |
| Trader registration | Portfolio 0 trader and later isolated subaccount registration confirmed | Explorer/Phoenix state | Pending |
| Deposit | Small USDC deposit; wallet and Phoenix balances update separately | Explorer plus before/after atomic balances | Pending |
| Market open/close | Isolated SOL-PERP market position appears, then reduce-only close reaches zero | Two signatures plus Phoenix state | Pending |
| Limit create/cancel | Native Phoenix limit rests and the same native ID disappears after cancel | Two signatures plus Phoenix state | Pending |
| Remaining withdrawal | Withdraw only the venue-reported safe amount; margin guard remains enforced | Signature plus wallet/Phoenix balances | Pending |

## Completion rule

After all rows contain direct evidence, update `FUTURES_COMPLETION_AUDIT.md` with the Explorer/venue references and recompute the budget total. Flay Futures remains incomplete while either signed venue flow is missing or while the budget evidence is absent.

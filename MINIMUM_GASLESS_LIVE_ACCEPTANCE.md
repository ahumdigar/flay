# Minimum gasless live acceptance record

Status: pending founder wallet approval

This record must contain only public transaction evidence. Never paste an identity token, private key, seed phrase, API key, raw signed transaction, or Privy authorization material.

## Read-only readiness evidence

- Wallet balance observed before signing: `0.003491559 SOL` and `0.191379 USDC`.
- A live Flay `JupiterAdapter` preparation for `0.19 USDC → SOL` returned route `JupiterZ` and mode `provider-sponsored`.
- Recorded and actual transaction fee payer both matched `7rhxnLV8C77o6d8oz26AgK8x8m5ePsdeRawjqvojbjnQ` for that quote.
- The embedded wallet address was a required signer and the estimated transaction network fee was `10220` lamports, paid by the recorded provider payer.
- A later fresh order passed the complete Flay transaction-structure check and unsigned RPC balance-delta simulation, including the route-scoped official JupiterZ Order Engine deployment.
- The quote was not signed or submitted. JupiterZ fee payers and quotes can change, so the app must reverify the fresh order at review.

## Test conditions

- Network: Solana mainnet-beta
- Feature: Convert → Market → Jupiter
- Wallet: founder-controlled Privy embedded Solana wallet
- Wallet SOL before review: `0.003491559 SOL` in the read-only readiness check
- Input asset and amount: use `0.19 USDC → SOL` while JupiterZ remains eligible; request a fresh route if it changes
- Prepared timestamp: pending

## Prepared-order evidence

- Flay prepared ID: pending
- Jupiter route/router: pending
- Gas mode shown by Flay: pending; must equal `provider-sponsored`
- Taker address: pending
- Recorded signature fee payer: pending; must differ from taker
- Message fingerprint: pending
- Quoted input/output and minimum output: pending
- Review displayed `Sponsored by Jupiter`: pending
- Review disclosed sponsorship recovery in quoted output: pending

## Signed execution evidence

- Privy approval completed by founder: pending
- Jupiter execution status: pending
- Transaction signature: pending
- Solana Explorer URL: pending
- Confirmed/finalized: pending
- Onchain fee payer: pending; must equal the recorded signature fee payer
- Taker signature present: pending
- Output credited at or above reviewed minimum: pending
- User SOL network fee debit: pending; must show the user did not pay the sponsored network fee

## Final decision

- Criterion 12 result: OPEN
- Reviewer/date: pending
- Notes: Deterministic implementation and read-only provider verification pass. A real wallet signature and confirmed sponsored transaction are still required.

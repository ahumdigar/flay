# Gasless USDC send live acceptance record

Status: pending founder Privy approval

This record contains public transaction evidence only. Never add an identity token, private key, seed phrase, raw transaction bytes, Privy authorization material, or billing credential.

## Read-only readiness evidence

- Checked at: `2026-09-22T09:03:50Z`
- Network: Solana mainnet-beta
- Sender: founder-controlled Privy embedded wallet `FexVXRLxhSgV2yW2VSJ54WQ3T58KQUr2Kikvr43nLMc7`
- Read-only recipient: `GCRJD52pGwcCSs4oswYxTBCPatxY1P6WpxCC9R9zty6r`
- Recipient canonical USDC ATA: `Dq6zgpPu7yscTeG9PvUjgPebhAb3PMiFaGbmkzBfg2pj`
- Simulated amount: `1` atomic USDC (`0.000001 USDC`)
- Prepared message hash: `a42c21ab6a69bb0db79f5bacf516f55a7cc51a26a4c0b363c5f354b56683d758`
- Gas mode: `provider-sponsored`
- Sponsorship provider: `Privy`
- Result: the live server confirmed sender balance, both canonical USDC accounts, exact `TransferChecked` structure, and successful unsigned RPC simulation. Nothing was signed or submitted.

## Required dashboard conditions

- Privy embedded wallet uses TEE execution: pending founder confirmation
- Privy Fee sponsorship has billing/credits: pending founder confirmation
- Sponsor gas fees enabled: pending founder confirmation
- Solana mainnet enabled: pending founder confirmation
- Client-initiated sponsorship enabled: pending founder confirmation
- Conservative sponsorship spend caps configured: pending founder confirmation

## Signed execution evidence

- Exact amount: use the smallest practical amount chosen by the founder
- Exact recipient: use a different wallet whose mainnet USDC ATA already exists
- Flay review displayed full recipient and exact amount: pending
- Flay review displayed `Sponsored by Privy`: pending
- Privy approval completed by founder: pending
- Transaction signature: pending
- Solana Explorer URL: pending
- Confirmed on Solana: pending
- Onchain instruction matches reviewed USDC amount/recipient: pending
- Recipient USDC credit equals reviewed amount: pending
- Onchain fee payer differs from sender: pending
- Sender lamport delta: pending; must equal zero
- Flay status endpoint returned `senderNetworkFeeLamports: "0"`: pending

## Final decision

- Acceptance criterion 17: OPEN
- Reviewer/date: pending
- Notes: All deterministic work and a live read-only mainnet preparation pass. The founder must approve one small send in Privy before the completion gate can pass.

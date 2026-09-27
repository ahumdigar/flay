# Flay gasless USDC send implementation plan

Status: active implementation plan

This plan adds one tightly bounded gasless wallet action: sending mainnet USDC from the authenticated Privy embedded wallet to an existing Solana USDC account. Privy supplies the managed fee payer through its React SDK. Flay does not operate a sponsor wallet, receive a sponsor key, deploy a program, or claim that unrelated actions are gasless.

## 1. Product behavior

1. A signed-in user opens Funds, enters a recipient Solana wallet and an exact USDC amount, and requests review.
2. Flay binds the request to the embedded wallet in the verified Privy identity token.
3. The server confirms the sender balance and requires the recipient's canonical USDC associated token account to exist. The first release does not sponsor token-account rent.
4. The server builds and simulates a single USDC `TransferChecked` transaction with no account creation, account closure, arbitrary program call, memo, or hidden fee.
5. Review shows the sender, recipient, amount, token, sponsorship provider, Flay fee, recipient-account restriction, and transaction expiry.
6. The user approves the reviewed transaction through Privy. Flay calls Privy's Solana `signAndSendTransaction` with `sponsor: true`; Privy replaces the fee payer/blockhash, signs as fee payer, and broadcasts.
7. Flay records the returned signature locally, checks authoritative Solana activity, and shows pending, confirmed, or failed state with an Explorer link.

## 2. Included scope

1. Mainnet native USDC only: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, six decimals, legacy SPL Token program.
2. Privy embedded Solana wallets already used by Flay.
3. Recipient wallet validation and canonical associated-token-account verification.
4. Exact decimal parsing, positive amount, u64 limit, balance check, and sender/recipient separation.
5. Server-built versioned transaction containing exactly one `TransferChecked` instruction.
6. Server simulation before review.
7. Privy app-pays sponsorship from the client SDK.
8. Responsive Funds UI, explicit review, submission result, balance refresh, retry, and Explorer recovery.
9. Deterministic service, API, UI, and authentication tests plus build and release audits.

Excluded:

1. SOL transfers, arbitrary SPL tokens, Token-2022, off-ramp, fiat withdrawal, bank withdrawal, and exchange-custody withdrawal.
2. Creating a recipient ATA, paying recipient account rent, or any `CreateAccount`/`CloseAccount` instruction.
3. Futures collateral actions, MagicBlock/PER actions, Jupiter limit orders, and non-Privy wallets.
4. A Flay fee payer, private sponsor key, relayer, Kora node, delegated wallet access, or custom Solana program.
5. A fallback to wallet-paid gas. If sponsorship is unavailable, the send fails clearly before any success claim.

## 3. Trust and security boundary

1. Every prepare request requires a valid Privy identity token and an exact embedded-wallet match.
2. Server input schemas accept only canonical Solana public keys and positive integer atomic amounts within u64.
3. The server derives both canonical USDC ATAs and verifies the recipient ATA already exists, belongs to the legacy SPL Token program, and stores USDC for the reviewed recipient.
4. The server checks the authenticated wallet's confirmed USDC balance immediately before building.
5. The serialized transaction has the authenticated wallet as its initial fee payer/authority, one required signer, no lookup table, and exactly one allowed instruction: USDC `TransferChecked` for the reviewed amount and recipient ATA.
6. The server simulates the exact unsigned message with signature verification disabled only because user and Privy signatures do not yet exist.
7. The browser does not construct transfer instructions or choose a mint/program. It submits only the server-produced transaction to Privy with `sponsor: true`.
8. The Privy confirmation interface remains visible. The user must approve every send.
9. No private key, wallet signature, identity token, serialized transaction, or sponsor credential is stored in activity history or logged.
10. The UI never says confirmed until Solana RPC confirms the submitted signature. A broadcast response is labeled submitted or pending.
11. Prepare is rate-limited per server/IP and Privy's dashboard must have conservative sponsorship caps and client sponsorship enabled only for the hackathon deployment.

## 4. Data contract

The prepare response exposes:

- `preparedId`, authenticated `wallet`, `recipient`, `transaction`, `messageHash`, and `expiresAt`.
- Fixed token metadata for mainnet USDC.
- `amountAtomic` and formatted amount.
- `gasPayment.mode = provider-sponsored`, `provider = Privy`, and disclosure that Flay charges 0%.
- Recipient ATA and review warnings.

The browser stores only safe recent-send metadata: signature, recipient, amount, creation time, and current onchain status. Solana activity remains the authoritative receipt.

## 5. Interface

1. Funds contains a `Send USDC` card beside the receiving-wallet information.
2. Signed-out state prompts login; missing wallet/balance states remain explicit.
3. Recipient and amount validate before prepare. A Max shortcut uses the confirmed USDC balance because gas is sponsored.
4. Review is a separate modal or panel and repeats the full recipient address and exact amount.
5. The approval action says `Approve gasless send`, names Privy as gas sponsor, and never implies that all Flay actions are gasless.
6. Submission shows the signature, pending/confirmed/failed state, Explorer link, retryable status refresh, and updated wallet balance.
7. Sponsorship-disabled, insufficient-credit, simulation, expired-review, rejected-wallet, RPC, and recipient-account errors remain actionable and do not white-screen the app.
8. Desktop and mobile layouts keep all fields, warnings, and recovery controls readable.

## 6. Implementation blocks

### A. Shared contract and server preparation

- Add shared prepared-send and recent-send types.
- Add strict request schemas.
- Build a dedicated transfer service that verifies accounts/balance, constructs one USDC transfer, validates its compiled message, simulates it, and retains only short-lived review records.
- Add authenticated, rate-limited prepare endpoint and truthful health metadata.

### B. Privy execution bridge

- Extend the auth bridge with a sponsored Solana sign-and-send method.
- Pass only the server-produced transaction, `sponsor: true`, mainnet chain, visible wallet confirmation, simulation enabled, and non-optimistic broadcast.
- Encode the returned 64-byte signature safely and reject malformed SDK results.

### C. Funds interface and recovery

- Add the Send USDC form, Max control, review, approval, errors, result state, status refresh, Explorer link, and balance refresh.
- Persist a bounded recent-send list without identity tokens or transaction bytes.
- Use a dedicated authenticated status endpoint that validates the exact onchain USDC instruction, recipient credit, and external fee payer before returning confirmed state.

### D. Verification and release evidence

- Unit-test amount/address/balance/account validation, exact instruction construction, forbidden instruction absence, simulation failures, and identity protection.
- Test the Privy sponsored-call options and Funds UI disclosures without broadcasting.
- Run typecheck/build, deterministic tests, dependency audit, release audit, and desktop/mobile browser audit.
- Complete one founder-approved small mainnet USDC send to an already initialized recipient, record its signature, confirm recipient credit, and verify the sender paid zero lamports.
- Write `GASLESS_USDC_SEND_COMPLETION_AUDIT.md` mapping every acceptance criterion to code and evidence.

## 7. Acceptance criteria

1. Only the authenticated embedded wallet can prepare its send.
2. Only mainnet legacy USDC can be sent; the client cannot choose mint, decimals, or token program.
3. Invalid/noncanonical/self recipient, zero/negative/exponent/excess-precision/over-u64 amount, and insufficient USDC are rejected.
4. The recipient's canonical USDC ATA must already exist and must match the reviewed recipient and mint.
5. The server-produced transaction has one wallet signer and exactly one USDC `TransferChecked` instruction for the reviewed amount and destination.
6. No account create, account close, SOL transfer, arbitrary program, lookup table, memo, or hidden fee exists in the prepared transaction.
7. Exact transaction simulation passes before review; simulation errors fail closed.
8. Privy execution receives the prepared bytes with `sponsor: true`, visible approval, mainnet chain, simulation enabled, and optimistic broadcast disabled.
9. No wallet-paid fallback occurs when Privy sponsorship is unavailable.
10. Review clearly shows exact amount, full recipient, USDC, Privy sponsorship, 0% Flay fee, and the existing-account restriction.
11. Submission never appears confirmed before RPC evidence and always exposes an Explorer recovery link.
12. Pending, confirmed, failed, user-rejected, sponsorship-disabled, credit-exhausted, expired, RPC, and malformed-signature cases produce usable states without a blank screen.
13. Recent sends remain bounded and contain no secret, identity token, signature bytes beyond the public transaction ID, or serialized transaction.
14. Desktop and mobile browser audits show a usable Funds send flow.
15. Setup documentation covers Privy TEE execution, prepaid/postpaid billing, Solana mainnet enablement, client sponsorship, spend caps, and recipient-ATA limitation.
16. Build/typecheck, deterministic tests, dependency audit, and release audit pass.
17. A founder-approved live mainnet send confirms exact recipient USDC credit and zero sender lamport fee debit.

## 8. Completion rule

Do not claim 100% completion until all 17 criteria map to actual code and evidence in `GASLESS_USDC_SEND_COMPLETION_AUDIT.md`. A missing Privy billing balance, dashboard sponsorship setting, TEE execution setting, initialized recipient USDC account, founder signature, confirmed mainnet receipt, or fee-delta evidence remains explicitly open. Complete every deterministic and read-only verification before reporting an external blocker.

# Flay minimum gasless implementation plan

Status: active implementation plan

This plan adds the smallest useful gasless path for the hackathon: Jupiter-managed sponsorship for eligible Convert market swaps. Flay does not fund a sponsor wallet, operate Kora, hold a sponsor key, or deploy a Solana program. Jupiter decides eligibility per prepared order and completes any provider signature through its `/execute` endpoint.

## 1. Product behavior

1. A user requests and reviews a Jupiter market swap as usual.
2. Flay prepares the order with the user's wallet as `taker` and without an integrator `payer`.
3. If Jupiter explicitly returns `gasless: true` and a valid `signatureFeePayer` different from the taker, Flay verifies that payer against the actual transaction and labels the order `Sponsored by Jupiter`.
4. The user signs the exact reviewed transaction with Privy. The wallet remains the authority for the swap and Flay never receives its private key.
5. Flay verifies the user's signature and unchanged message, then sends the partially signed transaction and original request ID to Jupiter `/execute`. Jupiter adds any required sponsor or market-maker signature and submits it.
6. If Jupiter does not sponsor an order, the existing user-paid flow remains available and is clearly labeled. Flay never promises or fakes gasless eligibility.

## 2. Scope

Included:

1. Jupiter market swaps in Convert.
2. Automatic Jupiter sponsorship and JupiterZ market-maker gas payment returned by `/swap/v2/order`.
3. Per-order sponsorship verification, review disclosure, signing, execution, receipt metadata, tests, and setup documentation.

Excluded:

1. Limit orders, Raydium, Orca, Futures, MagicBlock/PER, fiat deposits, wallet transfers, memes, and xStocks.
2. A Flay-funded payer, Kora or another relayer, a sponsor balance, private signing infrastructure, referral fees, and a custom Solana program.
3. A guarantee that every Jupiter order is gasless. Eligibility, routes, minimum trade size, and provider fees are controlled by Jupiter and can change per order.

## 3. Trust and validation boundary

1. Treat a prepared order as sponsored only when `gasless === true`, `signatureFeePayer` is a valid Solana public key, and it differs from the authenticated taker.
2. Deserialize the returned transaction and require its actual fee payer to equal `signatureFeePayer` for sponsored orders or the taker for user-paid orders.
3. Require the authenticated wallet to be a signer and reject any unrecognized required signer. A sponsored order may contain only the exact external signer addresses declared by that Jupiter response.
4. Persist the order request ID, original message bytes, wallet, quote, sponsorship metadata, expected fee payer, and allowed external signers in the short-lived prepared-order record.
5. On execute, require the signed transaction message to be byte-for-byte identical and cryptographically verify the taker's Ed25519 signature over it.
6. Sponsored partial transactions are simulated with signature verification disabled only because the provider signature is intentionally still absent. User-paid transactions retain full signature verification. Both paths simulate the exact signed message before `/execute`.
7. Fail closed on missing, malformed, contradictory, or changed sponsorship data. Do not downgrade an inconsistent sponsored response into a normal transaction.

## 4. Data contract

Prepared and execution responses expose safe gas-payment metadata:

- `mode`: `provider-sponsored` or `user-paid`.
- `provider`: `Jupiter` for sponsored orders, otherwise `null`.
- `feePayer`: the verified transaction fee payer.
- `signatureFeeLamports`, `prioritizationFeeLamports`, and `rentFeeLamports` when Jupiter provides them.
- `detail`: concise user-facing disclosure without secrets.

No sponsor credential or private signing material exists in Flay for this scope.

## 5. Fees and interface

1. Review shows `Network gas · Sponsored by Jupiter` only after the prepared transaction passes server validation.
2. Before preparation, the Jupiter route says eligibility is checked at review; it does not display a guaranteed gasless badge.
3. A sponsored review explains that Jupiter may recover sponsorship cost through the swap fee/output and that the quoted output already reflects provider fees.
4. A user-paid review continues to show the estimated SOL network fee and that the wallet pays it.
5. The signing button and success receipt identify a sponsored order without implying that other Flay features are gasless.
6. Non-Jupiter providers and every excluded product keep their existing gas behavior and labels.

## 6. Implementation blocks

### A. Shared contract and validator

- Add typed gas-payment metadata to prepared and execution responses.
- Support an explicitly expected fee payer and a bounded set of provider-declared external signers.
- Add Ed25519 verification for the authenticated wallet signature.
- Cover fee-payer, signer, altered-message, malformed-key, and altered-signature cases with deterministic tests.

### B. Jupiter adapter and execution

- Parse and validate Jupiter sponsorship, payer, router, gas fee, and rent fields.
- Store only verified sponsorship metadata from the prepared order.
- Preserve the exact request ID and message through partial signing.
- Use the partial-signature execution path only for verified sponsored Jupiter orders.
- Keep the full-signature behavior for user-paid and non-Jupiter paths.

### C. Convert interface

- Show gasless eligibility timing on the Jupiter route.
- Show verified sponsored/user-paid state in review, signing, success, and retry states.
- Disclose provider fee recovery and keep narrow/mobile layouts usable.

### D. Verification and release evidence

- Run type checking, deterministic tests, production build, browser audit, dependency audit, and release audit.
- Add a completion audit mapping every acceptance criterion to code and evidence.
- Record a live small-value eligible swap from a low-SOL embedded wallet, including the prepared payer and confirmed transaction, before claiming completion.

## 7. Acceptance criteria

1. The UI and documentation state that only eligible Jupiter Convert market swaps can be gasless.
2. Sponsorship is recognized only from an explicit `gasless: true` response with a valid fee payer different from the taker.
3. The actual transaction fee payer matches the recorded Jupiter payer; any mismatch is rejected before wallet signing.
4. The authenticated wallet is an exact required signer, and unknown required signers are rejected.
5. Execution accepts a partial provider signature only for the external signer addresses recorded from that prepared Jupiter order.
6. The taker's Ed25519 signature and the unchanged transaction message are verified before `/execute`.
7. Ineligible, malformed, contradictory, expired, or altered orders are never labeled or executed as sponsored.
8. Review and receipt disclose who pays network gas and that Jupiter may recover sponsorship cost through the quoted swap economics.
9. User-paid Jupiter orders and all excluded features retain honest user-paid behavior.
10. The implementation requires no Flay sponsor funds, sponsor secret, Kora service, referral fee, or custom program deployment.
11. Deterministic tests cover sponsored, user-paid, mismatch, tampering, idempotency, retry, and UI disclosure paths.
12. A founder-signed live eligible swap proves that a low-SOL Privy wallet can sign, Jupiter can co-sign/submit, and the transaction confirms with the recorded non-user fee payer.
13. Type checking, tests, production build, browser audit, dependency audit, and release audit pass.
14. Setup and operating documentation explain dynamic eligibility, supported scope, evidence collection, and safe fallback behavior.

## 8. Completion rule

Do not claim this minimum gasless block is complete until all fourteen criteria map to code and evidence in `MINIMUM_GASLESS_COMPLETION_AUDIT.md`. A missing live eligible order, wallet signature, provider co-signature, confirmed transaction, or required check leaves the block incomplete. Continue all implementation and deterministic verification that can be completed without the founder-signed transaction.

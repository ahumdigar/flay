# MagicBlock real authorization plan

**Status:** implementation verified; founder-wallet acceptance remains open

## Objective

Replace the mock-backed Private Payments login endpoints with MagicBlock's attested mainnet TEE authorization service while continuing to use the official Private Payments builders and keeping every provider token on Flay's server.

## Design

1. Add a separately configurable MagicBlock TEE endpoint, defaulting to `https://mainnet-tee.magicblock.app`.
2. Verify the TEE endpoint's hardware attestation with MagicBlock's official SDK and fail closed if attestation cannot be verified.
3. Fetch login challenges from `/auth/challenge` on the TEE endpoint and submit signatures to `/auth/login` on that same endpoint.
4. Retain the returned bearer token only in Flay server memory and use it for private-balance, private-transfer, withdrawal, and ephemeral submission requests through the Private Payments API.
5. Keep the MagicBlock account mounted and visibly show its signing stage while requesting Privy's message signature. During that stage, place Flay below Privy's documented modal layer and disable Flay pointer interception so the real approval surface remains visible and tappable. If Privy signs immediately, require the same server-side Ed25519 verification and expose the resulting non-secret authorization receipt.
6. Report MagicBlock ready only when the Private Payments service, initialized USDC mint, TEE attestation, and real non-mock authorization challenge all pass.
7. Update deterministic and opt-in live tests to cover the separate TEE and payments endpoints, including rejection of an invalid TEE signature.
8. Make the browser unlock operation self-recovering: expose its current stage, apply a bounded timeout to every remote/signing step, ignore late results after failure, and always restore the retry action.
9. After a successful private-balance read, display a non-secret authorization receipt containing the server-verified wallet-signature result, attested TEE result, provider-token acceptance, authorization time, expiry, and a one-way receipt fingerprint.
10. Reject provider authorization tokens explicitly marked as mock even when the challenge itself was non-mock.
11. Pin Flay to the current Privy React SDK before further browser diagnosis, enable embedded-wallet approval UI globally as well as on the MagicBlock signing call, and verify that the SDK returns either a signature or a surfaced rejection instead of leaving its promise pending. Keep the existing timeout as recovery, not as the normal result.

## Acceptance criteria

1. The configured TEE endpoint returns a non-mock challenge and rejects an invalid signature.
2. A valid signature obtains a real bearer token from the TEE endpoint.
3. That token successfully authorizes the official Private Payments private-balance endpoint.
4. Flay never returns or logs the bearer token.
5. Local `/api/magicblock/status` reports verified authorization only after TEE attestation succeeds.
6. The browser unlock flow no longer depends on the mock `/v1/spl/login` endpoint and never dismisses the MagicBlock account while waiting for Privy. It returns control in the same dialog after approval, immediate Privy signing, rejection, or timeout.
7. Existing deposit, private-transfer, withdrawal, signer, account, amount, program, and network validation remains intact.
8. Focused tests, full tests, type checking, production build, release audit, browser audit, dependency audit, and opt-in live MagicBlock verification pass.
9. Founder-wallet acceptance confirms unlock and private balance before the live user flow is declared complete.
10. A stalled Privy or network request cannot leave the MagicBlock modal busy indefinitely; the UI names the failed stage and permits a retry.
11. The unlocked UI visibly proves which live checks passed and never exposes the MagicBlock bearer token or raw signature.
12. A mock authorization token can never create an unlocked Flay session.
13. While waiting for Privy, the Flay overlay has a lower stacking layer and cannot intercept taps intended for Privy's approval controls.
14. The pinned Privy SDK opens or completes the embedded Solana message-signing flow for the founder wallet; the one-minute timeout is not treated as successful acceptance.

## Completion rule

Compare this plan with the final code and record the evidence in a completion audit. Missing TEE attestation, real-token verification, or founder-wallet acceptance keeps the corresponding acceptance criterion open.

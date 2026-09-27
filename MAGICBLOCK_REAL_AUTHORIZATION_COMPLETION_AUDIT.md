# MagicBlock real authorization completion audit

**Audited:** 2026-09-23  
**Overall status:** implementation and automated live-provider verification pass; founder-wallet browser acceptance remains open.

## Plan-versus-code comparison

1. **Real TEE authorization endpoint — pass.** `MagicBlockService` uses the separately configured `MAGICBLOCK_TEE_BASE_URL`, which defaults to `https://mainnet-tee.magicblock.app`, for `/auth/challenge` and `/auth/login`. The mock-backed Private Payments login routes are not used by the unlock flow.
2. **TEE attestation — pass.** Readiness calls `verifyTeeIntegrity` from the pinned official `@magicblock-labs/ephemeral-rollups-sdk@0.17.2`. The result is cached for five minutes, and readiness fails closed when attestation or the non-mock authorization probe fails.
3. **Real token interoperability — live pass.** The opt-in provider test signed the TEE challenge with a temporary Solana keypair, obtained a non-mock bearer token, and used it successfully on the official Private Payments private-balance endpoint.
4. **Server-only bearer token — pass.** The TEE bearer token remains in the server's in-memory session record. Browser responses contain only Flay's opaque session identifier, readiness data, balance data, and reviewed transaction data. Release source and browser-bundle scans pass.
5. **Truthful readiness — pass.** Local `/api/magicblock/status` reports `teeAttested: true`, `authorizationMode: verified`, `available: true`, and `privateTransfers: true`. Local `/api/health` derives `readiness.magicBlock: true` from that result.
6. **Browser unlock path — deterministic pass; founder acceptance open.** An initial founder-wallet trial proved that silent signing could stall. A later attempt showed that dismissing Flay before calling Privy could expose the homepage. The installed Privy SDK renders its general modal at stacking layer 50, while Flay's modal was at layer 100, so keeping Flay mounted still covered Privy's approval. The corrected signing state keeps the MagicBlock account mounted at layer 40, disables its pointer interception, and shows the exact signing stage while Privy's controls render above it.
7. **Transaction protections — pass.** Deposit, private transfer, withdrawal, wallet signer, recipient, amount, mint, token account, allowed program, blockhash, and submission-network validation remain active and covered by tests.
8. **Build and verification — pass.** The production build, full deterministic test suite, release audit, browser audit, dependency threshold audit, and opt-in live MagicBlock test pass.
9. **Founder-wallet acceptance — open.** The founder must unlock the protected balance in the running browser and confirm the private-balance result before Flay describes the full user flow as accepted.
10. **Bounded browser recovery — pass.** Challenge, Privy signature, TEE login, and protected-balance requests each have a timeout. The modal displays the active stage, clears its busy state after failure, restores itself after Privy exits, and allows a fresh retry. A server-rendered regression test covers the signing-stage diagnostic.
11. **Visible authorization receipt — deterministic pass; founder acceptance open.** A successful private-balance response now includes a non-secret receipt with the verified wallet-signature result, TEE-attestation result, provider-token acceptance, authorization time, expiry, and a one-way 24-character fingerprint. The bearer token and raw signature remain server-only.
12. **Mock-token rejection — pass.** A response token marked as mock is rejected with `MAGICBLOCK_AUTH_MOCK` and cannot create a Flay session, even after a valid wallet signature.
13. **Privy modal layering — deterministic pass; founder acceptance open.** The signing-stage overlay renders with `privy-signing-underlay`, stacking below Privy's installed layer and using `pointer-events: none`. A server-rendered UI regression test asserts both the underlay class and its user-facing state.

## Live evidence

- The mainnet TEE returned a challenge without the `MOCK:` prefix.
- The mainnet TEE rejected a deliberately invalid signature with HTTP 401.
- A valid Ed25519 signature returned a real bearer token.
- The real bearer token authorized the official Private Payments private-balance endpoint.
- The official SDK verified the mainnet TEE attestation before readiness became available.
- The live provider test also obtained and validated unsigned deposit, private-transfer, and withdrawal builder transactions without submitting funds.

## Verification record

- Opt-in live MagicBlock test: 1 passed.
- Full deterministic suite: 201 passed, 7 skipped behind existing live-provider gates.
- Type check and production build: passed.
- Release source and browser-bundle scan: passed; 246 bundle files checked.
- Browser audit: passed with no runtime exceptions.
- Production dependency audit at the moderate threshold: passed with no moderate, high, or critical findings.
- Upstream dependency limitation: three linked low-severity findings originate in `elliptic` through MagicBlock's `@phala/dcap-qvl` attestation dependency. npm only offers a breaking downgrade of the MagicBlock SDK, so the exact production SDK remains pinned.
- Local server: `http://0.0.0.0:5173` is running and reports verified, attested MagicBlock readiness.

## Remaining acceptance

Open **Wallet → MagicBlock account → Unlock protected balance** with the founder's Privy wallet. The MagicBlock account must remain visible while Flay waits. Privy may show an approval screen above it or may return an immediate signature under its embedded-wallet policy. Acceptance passes when the same account displays **TEE authorization verified**, the three verified/accepted checks, a receipt fingerprint, and the protected USDC balance. A zero balance is valid when the wallet has not deposited into PER.

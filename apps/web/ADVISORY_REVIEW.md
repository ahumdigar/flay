# Futures dependency advisory review

**Reviewed:** 2026-09-24  
**Scope:** `services/gmtrade-adapter/Cargo.lock` and the shipped web production dependency tree

## Rust scan result

`cargo audit` completed against 649 locked crates and reported six vulnerabilities plus eleven allowed maintenance or soundness warnings. This is an explicit release exception, not a clean scan.

| Advisory | Locked dependency | Dependency path | Flay exposure and mitigation |
| --- | --- | --- | --- |
| RUSTSEC-2024-0344 | curve25519-dalek 3.2.0 | gmsol-sdk 0.10.0 → Solana SDK 2.1.21 → ed25519-dalek 1.0.1 | The adapter uses `NullSigner`, accepts public keys only, and never performs a user signing operation. Every real wallet signature remains in Privy and is independently checked by the Node transaction boundary. |
| RUSTSEC-2022-0093 | ed25519-dalek 1.0.1 | gmsol-sdk 0.10.0 → Solana SDK 2.1.21 | The vulnerable signing API is not used: the Rust process has no private key and returns unsigned transactions. |
| RUSTSEC-2026-0258 | h2 0.3.27 | gmsol-sdk 0.10.0 → Solana 2.1.21 RPC client → reqwest 0.11 | The adapter is a private stdin/stdout sidecar with bounded commands, response-size limits, a 15-second supervisor timeout, forced restart, and per-venue isolation. A malicious or faulty upstream could still consume resources until the timeout. |
| RUSTSEC-2026-0098 | rustls-webpki 0.101.7 | gmsol-sdk 0.10.0 → Solana 2.1.21 RPC/TLS stack | HTTPS server-name validation is inside the pinned Solana client. RPC and GMTrade endpoints must remain operator-controlled HTTPS URLs; upgrading the pinned venue stack is required for removal. |
| RUSTSEC-2026-0099 | rustls-webpki 0.101.7 | same pinned Solana RPC/TLS stack | Same constraint and mitigation as RUSTSEC-2026-0098. |
| RUSTSEC-2026-0104 | rustls-webpki 0.101.7 | same pinned Solana RPC/TLS stack | Flay does not supply or parse certificate-revocation lists, but the affected code remains in the locked dependency graph. |

The eleven warnings are `bincode` 1.3.3, `bitmaps` 3.2.1, `derivative` 2.2.0, `libsecp256k1` 0.6.0, `number_prefix` 0.4.0, `paste` 1.0.15, and `rustls-pemfile` 1.0.4 as unmaintained; plus soundness warnings for `bitmaps` 3.2.1, `memmap2` 0.5.10, `rand` 0.7.3, and `solana_rbpf` 0.8.5.

These versions are pulled in by the plan-pinned `gmsol-sdk = 0.10.0` and Solana 2.1.21 graph. The fixed versions require a venue SDK/Solana generation change and cannot be forced into this lockfile safely. Before a public production release, upgrade to a GMTrade SDK line that uses fixed Solana, h2, and rustls-webpki versions, then repeat transaction-semantic tests, the live unsigned build and simulation, and `cargo audit`. This hackathon build records the exception and keeps the Rust boundary non-signing and private.

## JavaScript scan result

`npm audit --omit=dev` currently reports three low-severity instances of GHSA-848j-6mx2-7j84 in `elliptic@6.6.1`. The only path is `@magicblock-labs/ephemeral-rollups-sdk@0.17.2 → @phala/dcap-qvl@0.3.9 → elliptic`. The current MagicBlock SDK is the latest published release. The latest `@phala/dcap-qvl@0.6.3` still depends on the same affected `elliptic` line, so neither a direct upgrade nor an override removes the advisory. `npm audit fix --force` proposes downgrading the MagicBlock SDK to 0.8.5, which is a breaking change and does not establish a fixed attestation path.

The affected code verifies remote TEE attestation; it never receives a Flay wallet private key and is outside the xStocks/Jupiter path. MagicBlock remains deferred and incomplete under its separate plan. Flay fails closed when attestation cannot be verified. The hackathon gate runs `npm audit --omit=dev --audit-level=high`, which exits successfully with zero moderate, high, or critical findings, while the three low findings remain visible and accepted temporarily. Remove this exception when MagicBlock or Phala publishes a compatible dependency tree without `elliptic`; do not hide it with a forced downgrade.

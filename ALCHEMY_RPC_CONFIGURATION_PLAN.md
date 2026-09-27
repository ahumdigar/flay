# Flay Alchemy Solana RPC production configuration

**Status:** complete — see `ALCHEMY_RPC_CONFIGURATION_AUDIT.md`
**Date:** 2026-09-27
**Scope:** replace the rate-limited public Solana RPC used by local and Railway production runtimes with the founder-provided Alchemy endpoint

## Observed fault

The production Convert UI reports `429 Too Many Requests` and `Connection rate limits exceeded` while reading the authenticated wallet balance. The deployed health response confirms that Flay is using `api.mainnet-beta.solana.com`, so balance reads, simulations, account discovery, and provider adapters share a heavily rate-limited public endpoint.

The screenshots also contain an account-rent shortage and a Jupiter quote failure. The rent shortage is a real wallet-funding condition and must remain visible. The Jupiter failure may recover once RPC-dependent preparation is stable, but Flay must not misrepresent it if Jupiter itself has no route.

## Implementation plan

1. Validate the founder-provided Alchemy key against Alchemy's Solana mainnet JSON-RPC endpoint without printing or committing the key.
2. Update the ignored local `SOLANA_RPC_URL` value and the Railway production `SOLANA_RPC_URL` variable. Keep Railway's injected port and every unrelated production variable unchanged.
3. Let Railway restart the service with the new runtime variable, then verify that the final deployment succeeds and binds normally.
4. Confirm through the sanitized health response that Flay is using the Alchemy Solana host and that RPC blockhash and transaction-simulation probes pass.
5. Exercise repeated wallet-balance JSON-RPC calls plus the public Convert, Futures, Stocks, and health endpoints, and inspect final logs for RPC 429, crash, or HTTP 5xx records.
6. Run repository safety checks proving that the Alchemy key and complete endpoint are absent from tracked files and staged changes.
7. Compare every criterion with the final runtime state and record `ALCHEMY_RPC_CONFIGURATION_AUDIT.md` before declaring the migration complete.

## Acceptance criteria

1. The Alchemy Solana mainnet endpoint accepts a JSON-RPC health or blockhash request using the supplied key.
2. Local ignored configuration and Railway production use the Alchemy endpoint; the key is absent from tracked files, plans, audits, logs, and final reporting.
3. The replacement Railway deployment reaches `SUCCESS`, the root application and `/api/health` return HTTP 200, and health reports the Alchemy RPC host.
4. RPC readiness and simulation readiness are available, and repeated wallet-balance calls complete without HTTP 429.
5. Convert discovery, Futures markets, and Stocks directory endpoints respond without a server crash.
6. The genuine account-rent warning remains enforced when a transaction requires more SOL; no balance, quote, or transaction result is fabricated.
7. Final logs contain no RPC 429 or HTTP 5xx record from the verified deployment, repository safety checks pass, and the completion audit maps every criterion to evidence.

## Completion rule

Do not mark this migration complete until `ALCHEMY_RPC_CONFIGURATION_AUDIT.md` maps every acceptance criterion to final configuration and live Railway evidence.

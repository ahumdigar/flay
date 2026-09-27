# Flay Alchemy Solana RPC production configuration audit

**Status:** complete
**Date:** 2026-09-27
**Plan:** `ALCHEMY_RPC_CONFIGURATION_PLAN.md`
**Deployment:** `8b5e4ec7-9af9-49e6-8cd3-301385f2a9ea` (`SUCCESS`)

## Screenshot diagnosis

| Screenshot | Finding | Final result |
| --- | --- | --- |
| `yyitit.jpg` | The public Solana RPC rejected the wallet balance read with HTTP 429 and `Connection rate limits exceeded`. | Production now reports the Alchemy Solana host. Six full balance-read cycles completed without HTTP or RPC errors. |
| `hunbd.jpg` | Convert remained on `Waiting for live routes` after the RPC error. | Both photographed pairs return three current executable quotes with no provider failures. |
| `bhbcd.jpg` | Spending `0.001 SOL` from a `0.001053 SOL` balance leaves too little SOL for the selected route's account rent. | This remains an intentional fail-closed affordability check. The RPC change does not hide or sponsor required account rent. |
| `hhhv.jpg` | A manually selected Jupiter request reported `Failed to get quotes`. | Current live checks return a Jupiter route for both `0.04 USDC → SOL` and `0.001 SOL → USDC`; Raydium and Orca alternatives are also live. |

## Plan-to-runtime comparison

| Plan item | Evidence | Result |
| --- | --- | --- |
| 1. Validate Alchemy | Direct `getHealth` and `getLatestBlockhash` requests returned HTTP 200 with JSON-RPC results. | Pass |
| 2. Configure local and Railway runtimes | The ignored local `.env` and Railway `SOLANA_RPC_URL` use the Alchemy Solana mainnet endpoint. No unrelated variable was changed. | Pass |
| 3. Restart production | Railway created deployment `8b5e4ec7-9af9-49e6-8cd3-301385f2a9ea`; it reached `SUCCESS` and logged one normal bind on port 8080. | Pass |
| 4. Verify sanitized readiness | `/api/health` returns HTTP 200 with `status: ok`, reports `solana-mainnet.g.alchemy.com`, and marks blockhash and v0 simulation probes available. | Pass |
| 5. Exercise production workloads | Eighteen direct balance-workload calls returned HTTP 200 with zero 429 and zero JSON-RPC errors. Root, health, Futures, Stocks, and Convert discovery endpoints returned HTTP 200. | Pass |
| 6. Protect the credential | A value-based scan found the complete configured endpoint in zero tracked files and zero working-tree diffs. The real `.env` remains ignored. | Pass |
| 7. Complete the audit | This file maps all seven criteria to the final Railway runtime and repository evidence. | Pass |

## Acceptance criteria

1. **Valid endpoint — pass.** Alchemy accepted health and current blockhash calls.
2. **Correct configuration and isolation — pass.** Local and production configuration use Alchemy; neither the key nor the complete endpoint appears in tracked source, plans, audits, diffs, or reports.
3. **Healthy Railway replacement — pass.** The final deployment is `SUCCESS`; `/` and `/api/health` return HTTP 200; health identifies the Alchemy host.
4. **Balance and simulation reliability — pass.** Six `getBalance`, six legacy SPL account, and six Token-2022 account calls all succeeded. RPC and simulation readiness are true, with no 429 response.
5. **Public product surfaces — pass.** Convert discovery returns 20 results for `sol`; Futures returns three markets with GMTrade ready and Phoenix public data available; Stocks returns the complete live catalog of 1,124 assets.
6. **Affordability boundary — pass.** No code changed the account-rent or transaction-simulation checks. A wallet that spends nearly all SOL still receives the accurate rent-shortage message.
7. **Logs and repository safety — pass.** The final deployment contains no matched 429/error-level log and no HTTP 5xx record in the checked window. `git diff --check` and the credential-value scan pass.

All items in `ALCHEMY_RPC_CONFIGURATION_PLAN.md` and all seven acceptance criteria are implemented and verified.

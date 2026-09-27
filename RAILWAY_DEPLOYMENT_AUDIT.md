# Flay Railway production deployment audit

**Status:** complete
**Date:** 2026-09-27
**Plan:** `RAILWAY_DEPLOYMENT_PLAN.md`
**Public URL:** `https://flay-production.up.railway.app`
**Final deployment:** `d4ffea49-3504-440d-95cc-f32f52f4ad1c` (`SUCCESS`)

## Plan-to-code comparison

| Plan item | Final implementation and evidence | Result |
| --- | --- | --- |
| 1. Reproducible Node and Rust build | `Dockerfile` uses pinned Node 22 and Rust 1.90 multi-stage builds, `npm ci`, the committed web lockfile, and `cargo build --release --locked`. Railway built image digest `sha256:3473dca0044b46579b94ca71f8db0f6bb9cfeba7c1b66a28a0115e550a5a3a67`. | Pass |
| 2. Minimal non-root runtime | The runtime copies the Vite bundle, Express server/shared source, production dependencies, and compiled GMTrade binary; switches to `USER node`; binds through the existing `HOST=0.0.0.0` and Railway `PORT`; and includes an HTTP container health check. Deployment logs show `Flay listening on http://0.0.0.0:8080`. | Pass |
| 3. Railway service configuration | `.railway/railway.ts` declares one replica, `/` health check, 300-second health timeout, and `ON_FAILURE` with 10 retries. The final deployment manifest reports those exact values. | Pass |
| 4. Safe build context | `.dockerignore` excludes Git data, all environment files, dependency trees, build output, Rust targets, artifacts, logs, PIDs, and tests. | Pass |
| 5. Project, service, and variables | Railway project `016203a3-5640-4939-8835-88427b4b496f` and service `ba8f6a7a-ee6e-47fb-99c5-07a4b61162a9` are linked. Only the allowlisted runtime/build variables were set; Railway supplies `PORT`. No value is copied into repository configuration. | Pass |
| 6. Public deployment and smoke checks | Railway generated `flay-production.up.railway.app`. `/`, `/api/health`, `/api/futures/markets`, `/api/stocks`, and `/api/tokens?query=sol` each returned HTTP 200 after the final redeploy. | Pass |
| 7. Runtime stability | The final deployment is `SUCCESS`. Deployment error-log and HTTP 5xx queries returned no entries. Health reports GMTrade adapter `0.10.0` ready with its process running, Phoenix public data live, RPC and simulation available, and the xStocks directory ready. | Pass |
| 8. Verification and completion audit | TypeScript and Vite production build passed; 270 tests passed with 8 explicitly skipped; release audit passed across 246 bundle files; the browser audit passed against the Railway URL on desktop and mobile with zero runtime exceptions. This file records the required final comparison. | Pass |

## Acceptance criteria

1. **Independent locked build — pass.** Railway built both stages from repository source. The context excludes local `node_modules`, `dist`, and Rust `target` directories. The production-only dependency install also contains explicit `bigint-buffer` and `bn.js` runtime dependencies, avoiding reliance on the local dependency tree or Node-version-specific CommonJS named-export detection.
2. **Production runtime — pass.** The image runs as the unprivileged Node user, starts Express on Railway port 8080, returns the SPA and API over HTTPS, and exposes a running packaged GMTrade binary through `GMTRADE_ADAPTER_BIN`.
3. **Credential isolation — pass.** No real `.env` file or local build/runtime artifact is tracked. A tracked-file comparison found no forbidden environment file and no private credential value. The configured Solana URL is the credential-free public mainnet endpoint. The Privy browser app identifier and verification public key are public identifiers; the runtime environment remains in Railway variables and the Docker build receives only the required public `VITE_` values.
4. **Single-instance deployment policy — pass.** The final manifest reports `numReplicas: 1`, health path `/`, health timeout `300`, restart policy `ON_FAILURE`, and maximum retries `10`.
5. **Healthy public behavior — pass.** The shell and all representative public-data endpoints returned HTTP 200. Health status is `ok`; Convert token discovery returned 20 matches for `sol`; Futures returned three markets; Stocks returned 1,124 official xStocks assets with live status.
6. **Clean production logs — pass.** The final deployment starts once and listens on the expected port. There are no final-deployment error-level records, HTTP 5xx records, missing runtime modules, missing binary errors, crash-loop messages, or health-check failures.
7. **Checks and audit — pass.** `npm run build`, `npm run test`, `npm run release:audit`, the live `npm run browser:audit`, endpoint smoke checks, `git diff --check`, the tracked-file safety scan, and this plan-to-code comparison all passed.

## Live verification snapshot

- Deployment: `d4ffea49-3504-440d-95cc-f32f52f4ad1c` — `SUCCESS`
- Root shell: HTTP 200, Flay title present
- Health: HTTP 200, `status: ok`, Solana mainnet
- Futures: HTTP 200, three markets; GMTrade execution ready; Phoenix public data live with wallet onboarding required for execution
- Stocks: HTTP 200, live xStocks catalog with 1,124 assets
- Convert discovery: HTTP 200, 20 `sol` token results
- Browser audit: desktop and mobile layouts, Futures controls, Funds flow, Stocks catalog/prices, and Privy onramp routing passed with zero browser runtime exceptions

All items in `RAILWAY_DEPLOYMENT_PLAN.md` and all seven acceptance criteria are implemented and verified against the deployed revision.

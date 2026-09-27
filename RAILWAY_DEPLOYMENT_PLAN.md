# Flay Railway production deployment

**Status:** complete — see `RAILWAY_DEPLOYMENT_AUDIT.md`
**Date:** 2026-09-27
**Scope:** deploy the current Flay web application and GMTrade sidecar as one reproducible Railway service

## Goal

Publish the current private GitHub repository to a public Railway HTTPS endpoint without exposing local credentials. The production image must serve the Vite application, Express API, and the Rust GMTrade adapter required by Futures.

## Implementation plan

1. Add a multi-stage Docker build that compiles the pinned GMTrade Rust adapter, installs the locked Node dependencies, builds the Vite client, and produces one production runtime image.
2. Keep the runtime on a non-root user, bind Express to Railway's injected `PORT` on `0.0.0.0`, include only production dependencies and compiled/browser/runtime source, and provide a container health check.
3. Add Railway infrastructure configuration for the root Dockerfile, the public health endpoint, bounded startup time, one replica, and restart-on-failure behavior.
4. Add a Docker build-context exclusion file so local `.env` files, Git data, dependency trees, build outputs, logs, PIDs, tests, and local artifacts are never uploaded into the image context.
5. Create and link a Railway project and service under the authenticated founder account. Copy only the allowlisted required values from the ignored local environment into Railway, without printing their contents, and let Railway provide its own `PORT`.
6. Deploy the exact working tree, generate a Railway public domain, and verify the deployment status, root application shell, readiness endpoint, and representative public-data endpoints over HTTPS.
7. Inspect build and runtime logs for secret leakage, crash loops, missing binaries, provider initialization failures, and health-check failures. Correct any deployment issue and redeploy until the service is stable.
8. Run the repository's relevant checks and production build, compare every criterion with the final files and live deployment, record a completion audit, then commit and push the deployment configuration to `main`.

## Acceptance criteria

1. Railway builds the Node application and locked Rust GMTrade adapter from the repository without depending on local `node_modules`, `target`, or untracked files.
2. The runtime starts with Railway's injected port, runs as a non-root user, serves the production SPA and API, and can execute the packaged GMTrade adapter at its configured path.
3. No `.env`, credential value, private key, wallet signature, transaction body, or provider token is committed, embedded in the image, or exposed in command/report output.
4. The production service has exactly one replica and a bounded health check and restart policy suitable for Flay's in-memory prepared-intent state.
5. A Railway-provided HTTPS domain returns the Flay shell and a healthy readiness response; representative Convert, Futures, and Stocks public-data requests respond without a server crash.
6. The deployment logs show a stable running service and no missing-build-artifact, missing-sidecar, port-binding, or health-check failure.
7. Relevant tests, TypeScript checks, production build, deployment smoke tests, repository status checks, and the final plan-to-code audit pass before completion is declared.

## Completion rule

Do not mark this deployment complete until `RAILWAY_DEPLOYMENT_AUDIT.md` maps every acceptance criterion to final repository files and live Railway evidence.

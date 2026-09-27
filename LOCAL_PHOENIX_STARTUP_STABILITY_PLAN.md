# Flay local Phoenix startup stability

**Status:** complete — see `LOCAL_PHOENIX_STARTUP_STABILITY_AUDIT.md`  
**Date:** 2026-09-27  
**Scope:** keep the supervised local app online when the Phoenix SDK abandons a background HTTP startup request

## Observed fault

Starting Flay locally reaches `http://127.0.0.1:5173`, but the Phoenix SDK later raises an orphaned rejection for an aborted `https://perp-api.phoenix.trade` request. The request is a recoverable provider-connectivity failure, yet the global process-safety handler currently treats every non-RPC background rejection as fatal. The supervisor restarts the server, causing repeated local outages.

## Implementation plan

1. Recognize only an aborted Phoenix HTTP API connection failure whose message names the official Phoenix API origin and the aborted operation.
2. Contain that orphaned provider rejection in the process-safety handler while preserving fatal behavior for arbitrary aborts, other domains, provider validation failures, and unknown unhandled errors.
3. Add focused positive and negative tests for the classification boundary.
4. Run focused and full tests, production build, release audit, restart the supervised server, and verify both the app shell and health endpoint remain available.
5. Compare this plan with the final code and record a completion audit before declaring the correction complete.

## Acceptance criteria

1. The exact Phoenix background connection-abort seen in the local log no longer terminates the Node process.
2. An unrelated `AbortError`, an error from a different domain, and unknown failures remain fatal.
3. The supervised local server survives the Phoenix failure window and responds at `http://127.0.0.1:5173`.
4. Focused tests, full tests, production build, release audit, health verification, and the completion audit pass.

## Completion rule

Do not mark this correction complete until `LOCAL_PHOENIX_STARTUP_STABILITY_AUDIT.md` maps every criterion to final code and verification evidence.

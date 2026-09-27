# Flay GMTrade adapter timeout correction

**Status:** complete — see `GMTRADE_ADAPTER_TIMEOUT_FIX_AUDIT.md`  
**Date:** 2026-09-27  
**Scope:** stop valid GMTrade portfolio reads from killing the local sidecar and showing a false recovery warning

## Observed fault

The Futures UI reports that GMTrade is temporarily unavailable while recovering. The live health probe subsequently reports GMTrade ready with its entry circuit closed. A direct mainnet portfolio read for the founder wallet succeeds in about 7.7 seconds, and a cold `health` + `markets` + `portfolio` sequence succeeds in about 11.8 seconds. The runtime code defaults to a five-second sidecar timeout, while `.env.example` documents 15 seconds. Because the Rust sidecar handles its input sequentially, the five-second default can terminate a healthy read and cascade a temporary recovery error to nearby requests.

## Implementation

1. Align the runtime default with the documented bounded 15-second GMTrade adapter timeout while retaining the existing 100 ms minimum and 30-second maximum environment override.
2. Preserve fail-closed behavior: a real timeout still terminates the stalled child, rejects affected reads, exposes cached positions and recovery controls, and waits for the bounded restart cooldown.
3. Do not automatically retry `prepare_action` or any transaction-building request; no transaction request may be duplicated during recovery.
4. Add focused coverage for the corrected default and retain the existing timeout, crash, cooldown, and restart tests.
5. Restart the supervised local server so the new default is active, then verify direct mainnet portfolio latency, GMTrade readiness, the full test/build checks, release audit, and browser audit.
6. Before claiming completion, compare every criterion with the final code and write `GMTRADE_ADAPTER_TIMEOUT_FIX_AUDIT.md`.

## Acceptance criteria

1. With no `GMTRADE_ADAPTER_TIMEOUT_MS` override, the adapter uses the documented 15-second bound rather than five seconds.
2. The founder-wallet portfolio probe that previously exceeded five seconds completes within the new bound without entering the recovery state.
3. Explicit short-timeout tests still terminate an unresponsive child and enforce the restart cooldown; transaction building remains non-retried.
4. Local health reports GMTrade public data and execution ready with the GMTrade entry circuit closed after restart.
5. Focused tests, full checks, release scan, browser audit, and the final plan-to-code audit pass.

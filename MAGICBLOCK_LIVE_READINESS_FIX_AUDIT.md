# MagicBlock live-readiness fix audit

> Superseded on 2026-09-23 by [MagicBlock real authorization completion audit](MAGICBLOCK_REAL_AUTHORIZATION_COMPLETION_AUDIT.md). This file preserves the evidence that exposed the mock Payments login route; Flay now uses the separate attested mainnet TEE authorization service.

**Audited:** 2026-09-23  
**Overall status:** implementation verified; live private access remains incomplete because the provider is returning mock authorization.

## Plan comparison

1. **Mock readiness detection — pass.** `MagicBlockService.status()` probes the official challenge endpoint with `mock=false`. A `MOCK:` challenge returns `available: false`, `privateTransfers: false`, and `authorizationMode: mock`.
2. **No mock wallet signature — pass.** `MagicBlockService.challenge()` rejects mock challenges with `MAGICBLOCK_AUTH_MOCK` before returning anything to the browser.
3. **Truthful paused UI — pass.** The wallet card displays `PAUSED`; the MagicBlock modal explains that private PER access is not live and renders no unlock button. A server-rendered UI test covers this state.
4. **Truthful global health — pass.** `/api/health` now derives `readiness.magicBlock` from the live MagicBlock status and includes `magicBlockReadiness` diagnostics.
5. **Verified-mode path preserved — deterministic pass.** A non-mock challenge reports verified readiness, and the existing login, balance, prepare, exact transaction validation, and execution tests pass.
6. **Mobile signing recovery — deterministic pass.** Once verified authorization is available, the explicit Flay unlock click uses Privy headless message signing and keeps the Flay modal visible. The 30-second recovery timeout remains active.
7. **Live private access — open.** The provider currently returns a mock challenge and accepts an invalid signature. A founder-wallet live authenticated PER flow must wait until MagicBlock enables verified authorization.

## Live evidence

- `GET /v1/spl/challenge?...&cluster=mainnet&mock=false` returned a challenge beginning `MOCK:`.
- `POST /v1/spl/login` with a deliberately invalid signature returned HTTP 200 and `mock-auth-token`.
- `GET /v1/spl/private-balance` accepted that mock token.
- Local `GET /api/magicblock/status` now returns `authorizationMode: mock`, `available: false`, and `privateTransfers: false`.
- Local `GET /api/health` now returns `readiness.magicBlock: false`.

## Verification

- Focused tests: 22 passed.
- Full suite: 198 passed, 7 live tests skipped by their existing environment gates.
- Type check and production build: passed.
- Release source and bundle scan: passed.
- Browser audit: passed with no runtime exceptions.
- Production dependency audit: 0 vulnerabilities.

## Remaining acceptance

Do not call MagicBlock private access live until the official endpoint rejects invalid signatures, the status changes to `authorizationMode: verified`, and a founder wallet completes unlock, private-balance read, and a small signed PER action.

# Flay Privy local authentication origin fix

**Status:** cancelled after founder confirmed Google/email login works; no implementation was made  
**Date:** 2026-09-24  
**Scope:** local Google/email authentication and isolated checkout origin

## Proven failure

The screenshot at `/storage/emulated/0/hackthon/juggr.jpg` was initially interpreted as an unresponsive Google/email action. The founder then confirmed that login works and there is no authentication problem. This proposed change is cancelled and must not be implemented.

## Implementation

1. Before React or Privy mounts, detect browser pages opened on `127.0.0.1` and replace that URL with the equivalent `localhost` URL.
2. Preserve protocol, port, path, checkout query parameters, and hash so main-app and isolated-checkout navigation continue at the same location.
3. Leave `localhost`, deployed hosts, IPv6, and other origins unchanged.
4. Keep API health reachable locally and keep the persistent Flay development server running.
5. Add focused tests for main-page and checkout URL canonicalization and update browser verification to prove a `127.0.0.1` entry reaches `localhost` before authentication UI is used.

## Acceptance criteria

1. Opening `http://127.0.0.1:5173` automatically lands on `http://localhost:5173` before `PrivyProvider` mounts.
2. An isolated checkout opened with fiat, amount, and request parameters keeps every parameter after canonicalization.
3. The Google/email action is rendered on the canonical Privy origin and the incorrect-origin setup failure is absent once Privy becomes ready.
4. Production/deployed URLs are never rewritten.
5. Focused tests, full tests, TypeScript, production build, release audit, targeted browser audit, full browser regression, and local health pass.
6. `PRIVY_LOCAL_AUTH_ORIGIN_FIX_AUDIT.md` maps every criterion to final code and records the founder's authenticated login retest before this fix is called fully complete.

## Completion rule

Complete all autonomous implementation and verification before requesting a founder retest. Do not call the fix fully complete until the founder confirms that the canonical local page opens Privy's Google/email authentication UI.

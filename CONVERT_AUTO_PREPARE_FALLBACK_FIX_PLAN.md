# Flay Convert automatic preparation fallback

**Status:** active  
**Date:** 2026-09-27  
**Scope:** make Auto select the best route that can produce an exact reviewed transaction

## Observed fault

The founder's `oyur.jpg` shows three fresh SOL-to-USDC quotes. Auto selects Jupiter at `0.143482 USDC`, but pressing Review returns `Jupiter: Failed to get quotes` even though current Raydium and Orca alternatives remain visible. Quote ranking works, but exact preparation stops after the first venue fails. Native-SOL direct routes are also rejected by a generic 0.005 SOL reserve before Flay can build and simulate their exact fee requirements.

## Implementation plan

1. Build a deterministic preparation candidate list from the current response: Auto uses ranked live quotes once each; a manual venue uses only the selected quote.
2. During Auto preparation, try the next current candidate only when the previous API failure is explicitly retryable or is an explicit venue-local route/build unavailability. Stop immediately for wallet, identity, validation, balance, or transaction-safety errors.
3. Preserve the actual prepared provider, exact transaction, output, minimum, fees, gas mode, warnings, wallet binding, and review screen returned by the successful fallback. Never combine values between venues or fabricate a route.
4. Keep manual Jupiter, Raydium, or Orca selection fixed to that venue and surface its real failure without fallback.
5. For market preparation, precheck the exact input principal with zero speculative SOL reserve for every venue. Continue to require the freshly built transaction to pass structural validation and exact Solana simulation, which determines its real network fee and rent affordability before signing.
6. If every eligible Auto candidate has a retryable failure, show one bounded error identifying the attempted venues and their user-safe messages.
7. Add focused tests for ranked Auto candidates, manual-route isolation, duplicate prevention, retryable and venue-local fallback eligibility, bounded combined errors, and the exact-simulation affordability boundary.
8. Validate the founder wallet's reported small SOL-to-USDC path against live providers without signing, then run focused and full tests, production build, release audit, browser audit, local health, and a changed-path marker scan.
9. Compare every item and acceptance criterion with final code in a completion audit before declaring completion.

## Acceptance criteria

1. With live Jupiter, Raydium, and Orca quotes, Auto tries them in ranked response order and stops on the first exact preparation success.
2. A retryable Jupiter failure or explicit `Failed to get quotes` venue rejection can reach a valid Raydium or Orca review instead of ending at the global error banner.
3. Manual venue selection never switches providers automatically.
4. Identity, wallet, input-balance, exact SOL/rent, and transaction-validation errors never trigger another venue attempt.
5. Native SOL principal is prechecked without the old fixed 0.005 SOL buffer, while exact transaction simulation remains mandatory and rejects a real fee or rent shortfall before signing.
6. The review and eventual execution remain bound to one successful provider transaction and the authenticated wallet.
7. All-route failure reporting is bounded, actionable, and contains no raw provider payload or secret data.
8. Focused tests, full tests, build, release scan, browser audit, live provider evidence, local health, marker scan, and completion audit pass.

## Completion rule

Do not mark this correction complete until `CONVERT_AUTO_PREPARE_FALLBACK_FIX_AUDIT.md` maps every criterion to final code and verification evidence.

# Alchemy Pay waiting checkpoint

Updated: 2026-09-22

## Scope clarification

The implemented feature is **fiat on-ramp**: users pay fiat through Alchemy Pay and receive USDC on Solana in their authenticated Privy embedded wallet.

**Off-ramp** means selling crypto and receiving fiat in a bank account or card. Off-ramp has not been implemented and remains outside the current plan.

## Current progress

- Blocks A–C are implemented and verified: server core, signed callbacks/reconciliation, and responsive Add Funds interface.
- Block D automated release proof passes; external merchant proof is waiting.
- 16 of the 18 acceptance criteria pass.
- Production build passes.
- Full deterministic suite passes: 31 test files and 146 tests.
- Focused Alchemy/API/UI suite passes: 4 files and 18 tests.
- Desktop and mobile browser audit passes without runtime exceptions.
- Release bundle scan passes across 246 files.
- Production dependency audit reports zero vulnerabilities.
- Local server health is OK and the Add Funds page is available.

## Implemented behavior

1. Server-signed hosted Alchemy Pay checkout.
2. USDC on Solana fixed server-side.
3. Checkout bound to the authenticated Privy embedded wallet.
4. Exact fiat allowlist and decimal/range validation.
5. Unique orders persisted atomically before response.
6. Authenticated wallet-isolated order history and refresh.
7. Constant-time webhook signature and timestamp verification.
8. Mismatch, replay, duplicate, stale, and out-of-order callback protection.
9. Provider payment status kept separate from verified receipt.
10. Positive onchain USDC balance-delta verification before showing funds received.
11. Test/production host separation and visible test-mode labeling.
12. Checkout, retry, explorer, wallet copy, and balance-refresh interface controls.

## Waiting on Alchemy Pay

1. Confirmation that sandbox access is free or suitable for a USD 10 hackathon budget.
2. Sandbox `appId` and `appSecret`.
3. Sandbox payment/minimum-order instructions.
4. Callback and outbound-IP allowlisting requirements.
5. Production onboarding, KYB, setup, monthly, and minimum-volume terms.

Do not place the Alchemy Pay app secret in chat, source control, or any `VITE_` environment variable. Add it directly to the server `.env` or deployment secret manager.

## Resume steps after their reply

1. Review Alchemy Pay's response and commercial limits.
2. Configure test credentials and the deployed public HTTPS origin.
3. Confirm the provider-supported minimum and align Flay's configured minimum.
4. Generate an accepted sandbox checkout for the actual Privy wallet.
5. Record a real signed callback, restart persistence, provider order, and Solana receipt evidence.
6. If production access is approved and affordable, run the smallest permitted founder-controlled order.
7. Update `ALCHEMY_PAY_COMPLETION_AUDIT.md`; only then reassess the two open acceptance criteria.

## Reference files

- `agent.md`
- `HACKATHON_ALCHEMY_PAY_PLAN.md`
- `ALCHEMY_PAY_COMPLETION_AUDIT.md`
- `apps/web/server/alchemy-pay-service.ts`
- `apps/web/src/fiat/FundsPage.tsx`
- `apps/web/README.md`

# Flay Privy fiat onramp implementation plan

**Status:** active implementation scope  
**Initial environment:** Privy sandbox  
**Destination:** native USDC on Solana mainnet-format wallet addresses  
**Custody:** funds go directly to the authenticated exportable Privy wallet

## 1. Product behavior

1. A signed-in user opens Funds, chooses a supported fiat currency and starting amount, and launches Privy's card-onramp modal.
2. Flay binds the destination to the authenticated embedded Solana wallet. The browser cannot substitute another address, asset, or network through the Funds form.
3. Privy selects an available regulated provider from its supported onramp set. The provider owns payment-method collection, KYC, pricing, fees, regional eligibility, and crypto delivery.
4. Flay never receives card data, bank credentials, or KYC documents and charges no onramp fee.
5. Sandbox is the safe default. Production requires an explicit public environment setting and the corresponding Privy dashboard/provider configuration.
6. A submitted or confirmed provider result closes the flow cleanly, explains its status, and refreshes the authoritative Solana USDC balance. Cancellation and provider errors remain retryable without a blank screen.

## 2. Included scope

1. Privy's React `useFiatOnramp` flow inside the existing `PrivyProvider`.
2. The authenticated Privy embedded Solana wallet as the fixed destination.
3. Solana native USDC mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` and Solana mainnet CAIP-2 chain `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`.
4. Privy sandbox and explicit production opt-in through a public, non-secret build setting.
5. The immediately available card currencies USD, EUR, AUD, and BRL. Broader currencies, including BDT, are described as requiring Meld configuration and KYB rather than shown as guaranteed.
6. Card, Apple Pay, Google Pay, and other methods only when Privy's selected provider offers them for the user's region.
7. Funds-page status, provider boundary, wallet destination, balance refresh, accessibility, responsive behavior, tests, setup documentation, and release evidence.

## 3. Excluded scope

1. Off-ramp, fiat withdrawal, bank payout, debit-card issuance, or exchange custody.
2. Flay collection or storage of payment, bank, identity, or KYC information.
3. A Flay payment processor, merchant-of-record role, custom checkout, custom Solana program, or server-side wallet signing.
4. Guaranteed payment methods, currencies, fees, quotes, approval, or geographic availability.
5. Production BDT support before Meld KYB and provider availability are verified.
6. Removal of the paused Alchemy Pay implementation or its historical plan/checkpoint; it remains dormant as a possible later fallback.

## 4. Trust and configuration boundary

1. The onramp launch method exists only inside the configured `PrivyProvider` bridge.
2. The bridge ignores arbitrary destination data from page inputs and supplies the currently authenticated embedded Solana wallet, fixed Solana chain, and fixed USDC mint.
3. The page can supply only a validated supported fiat currency and a bounded decimal starting amount.
4. Sandbox is selected unless `VITE_PRIVY_ONRAMP_ENV=production` is explicitly set at build time. This value is public configuration and must contain no secret.
5. The Privy modal remains visible and owns provider choice, final quote, fees, KYC, payment authorization, and completion state.
6. Flay treats `submitted` as pending and `confirmed` as provider-confirmed, then refreshes Solana balances. It does not invent an order, transaction hash, or settled balance.
7. Cancellation, rejection, unsupported region, provider outage, and incomplete dashboard configuration are presented as actionable errors.

## 5. Interface

1. Replace the inactive Alchemy Pay card with a Privy onramp card while preserving the existing Funds and gasless-send layout.
2. Clearly show Privy as the orchestrator and Stripe, Meld, MoonPay, or Coinbase as possible providers selected by availability.
3. Show Sandbox prominently until production is explicitly configured.
4. Display the full receiving wallet, Solana USDC destination, no Flay custody, and 0% Flay fee.
5. Keep the launch action usable only after authentication, wallet readiness, valid currency, and valid amount.
6. Show submitted, confirmed, cancelled, and failed outcomes without claiming onchain receipt before the refreshed wallet balance reflects it.
7. Remove active Alchemy checkout creation, tracking, callback-return, and merchant-credential messaging from the shipped Funds flow.

## 6. Implementation blocks

### A. Privy bridge

- Add a typed fiat-onramp method and environment to `FlayAuth`.
- Initialize `useFiatOnramp` under `PrivyProvider`.
- Bind Solana CAIP-2, native USDC mint, and embedded wallet address inside the bridge.
- Normalize provider errors and return only `submitted` or `confirmed` to the page.

### B. Funds interface

- Replace the Alchemy checkout state and API calls with the Privy modal launcher.
- Keep safe amount/currency validation and direct-wallet disclosures.
- Add pending/confirmed result feedback and balance refresh.
- Keep card/KYC data outside Flay and preserve the gasless USDC-send block.

### C. Health and documentation

- Report Privy onramp as the active fiat provider in health metadata while retaining the paused Alchemy capability record.
- Document dashboard enablement, allowed origins, sandbox testing, production opt-in, regional limitations, and Meld KYB for broader currency coverage.
- Preserve `ALCHEMY_PAY_WAITING_STATUS.md` and related implementation files as inactive fallback history.

### D. Verification

- Unit-test fixed destination options, sandbox default, production opt-in, amount/currency validation, result handling, and errors.
- Run the full deterministic test suite, TypeScript/production build, release audit, dependency audit, and desktop/mobile browser audit.
- Complete one founder-operated Privy sandbox checkout and record the visible provider result before any 100% completion claim.

## 7. Acceptance criteria

1. Funds launches Privy's onramp modal through the configured Privy React SDK.
2. The destination is always the authenticated embedded Solana wallet, native Solana USDC mint, and exact Solana mainnet CAIP-2 chain.
3. Page-controlled input cannot override destination wallet, mint, chain, or provider result.
4. Sandbox is the default and production requires explicit configuration.
5. Only supported fiat values and bounded decimal amounts reach the bridge.
6. The UI names Privy and possible downstream providers without promising a provider, payment method, fee, quote, or country.
7. Flay collects and stores no card, bank, or KYC data.
8. Submitted, confirmed, cancelled, provider-error, unsupported-region, and missing-configuration outcomes remain understandable and retryable.
9. A successful provider result triggers an authoritative wallet-balance refresh without fabricating settlement or transaction history.
10. The active Funds flow makes no Alchemy checkout/order API request and shows no Alchemy merchant-credential blocker.
11. Desktop and mobile layouts remain usable, keyboard accessible, and free of runtime exceptions.
12. Health and setup documentation truthfully describe the active provider, sandbox state, production switch, and Meld KYB requirement for BDT/broader coverage.
13. No private key, Privy secret, payment data, identity document, or provider credential is added to client code, logs, or repository files.
14. Type checking, deterministic tests, production build, release audit, dependency audit, and browser audit pass.
15. A founder-operated sandbox checkout opens for the bound wallet and produces a real Privy provider submitted/confirmed outcome.

## 8. Completion rule

Do not claim this block is 100% complete until all fifteen acceptance criteria map to actual code and evidence in `PRIVY_FIAT_ONRAMP_COMPLETION_AUDIT.md`. Missing Privy dashboard enablement, provider sandbox access, founder interaction, or provider result leaves criterion 15 open. Complete all deterministic implementation and verification before reporting that external gate.

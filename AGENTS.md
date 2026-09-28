# Flay repository rules

These rules apply to every implementation session in this repository.

## Delivery process

1. Build one complete product block at a time. Finish its UI, API, provider integration, transaction handling, error states, security checks, tests, and documentation before starting the next block.
2. Before implementation, write a concrete plan and embed it in `agent.md`.
3. Before declaring work complete, compare the final repository with every plan item and acceptance criterion, run the relevant checks, and embed a completion audit in `agent.md`.
4. Never lower an acceptance criterion to permit a completion claim. Report external access, funding, provider, or founder-signature gates truthfully.
5. Keep the root `README.md` current. Do not add separate historical plan, audit, status, or duplicate README files to the repository.

## Product integrity

- Use live provider and onchain data. Never silently substitute illustrative quotes, balances, activity, candles, positions, orders, transactions, or fiat status.
- Users sign their own Solana transactions. Flay must never receive or store an embedded-wallet private key.
- Bind state-changing requests and prepared transactions to the authenticated wallet and reviewed intent.
- Validate provider-built transactions before signature and revalidate or simulate them before execution where required.
- Keep provider secrets, identity tokens, signed transactions, private RPC URLs, and request bodies out of client bundles, Git, and logs.
- Preserve access to existing positions, cancellation, withdrawal, and recovery controls when a provider is degraded.
- Describe privacy precisely. MagicBlock protected state does not make third-party Solana trades private.
- Do not add a Flay sponsor key or custom Solana program without an explicit reviewed plan and security boundary.

## Verification

Run the smallest meaningful checks during development and the complete relevant checks before completion:

```sh
cd apps/web
npm run check
npm run release:audit
```

Run browser audits for UI changes and live mainnet probes only when the required credentials and safe non-signing conditions are available. Never submit a real transaction from an automated test.

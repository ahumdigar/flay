# Flay implementation record

## Permanent completion rule

Before implementing a new block, write its plan and acceptance criteria here. Before declaring it complete, compare the final repository with every requirement, run the relevant build, test, security, and live checks, and add a plan-to-code completion audit here. Do not stop at a visually finished interface when execution, recovery, security, or evidence remains incomplete.

## Completed plan: repository documentation cleanup

**Status:** complete
**Date:** 2026-09-28
**Scope:** remove obsolete documentation from the GitHub repository and replace the root README with one professional, accurate project guide

### Implementation plan

1. Inventory every tracked file and classify documentation as required operational guidance, repository instructions, or historical implementation evidence.
2. Retain only `README.md`, `AGENTS.md`, and `agent.md` as project-authored Markdown files. Consolidate current setup, architecture, feature, security, testing, deployment, and limitation details into the root README before removing duplicate component documentation.
3. Remove superseded plans, audits, acceptance notes, research notes, status checkpoints, duplicated nested READMEs, and the vendored package README. Do not remove source, tests, lockfiles, deployment configuration, environment examples, or Rust audit configuration.
4. Rewrite `AGENTS.md` as concise durable repository rules without references to deleted history. Rewrite `agent.md` as the concise permanent completion rule plus this cleanup plan and its final audit.
5. Verify that no source, script, package manifest, Docker build, or configuration file references a removed document.
6. Run the production build, full test suite, release audit, Markdown-link check, secret/tracked-artifact scan, Docker-context review, and live deployment health checks.
7. Compare the final repository against every acceptance criterion, embed the completion audit in `agent.md`, remove the temporary plan file so it does not become new clutter, then commit and push the cleanup to `main`.

### Acceptance criteria

1. The repository contains only the three necessary project-authored Markdown files: `README.md`, `AGENTS.md`, and `agent.md`.
2. The root README accurately explains Flay, its live features, architecture, trust boundaries, prerequisites, local setup, environment configuration, scripts, deployment, project structure, and current limitations.
3. All historical and duplicated documentation is removed without deleting runtime source, tests, lockfiles, infrastructure, environment examples, or required third-party package code.
4. No retained source or configuration references a removed Markdown file, and every relative link in the retained Markdown resolves.
5. Build, TypeScript checking, full tests, release scan, and live Railway health verification pass after cleanup.
6. No secret, real `.env`, dependency tree, build output, log, PID, or local artifact becomes tracked.
7. The final plan-to-repository audit is embedded in `agent.md`, Git is clean after commit, and `origin/main` contains the cleanup.

### Completion rule

Do not declare the cleanup complete until the final tracked-file inventory, repository checks, live checks, and embedded plan-to-code audit pass.

## Repository documentation cleanup audit

**Status:** complete
**Date:** 2026-09-28

### Plan-to-repository comparison

1. **Documentation inventory — pass.** The pre-cleanup Git tree contained 78 Markdown files. Seventy-five historical plans, audits, status notes, research notes, duplicate component READMEs, and vendored explanatory files are removed. The intended final tree retains only `README.md`, `AGENTS.md`, and `agent.md`.
2. **Professional root README — pass.** `README.md` now covers the product, live URL, shipped features, architecture, transaction flow, trust model, technology, repository structure, prerequisites, local setup, environment variables, Privy configuration, commands, dependency advisories, Railway deployment, and current product boundaries.
3. **Runtime preservation — pass.** Every staged deletion is a Markdown file. Source, tests, package manifests, lockfiles, Docker/Railway configuration, `.env.example`, the Rust audit configuration, and the vendored compatibility implementation remain present. A fresh `npm ci --ignore-scripts` installed 955 packages and the four required `bigint-buffer` exports loaded successfully.
4. **References and links — pass.** No retained source or configuration references a removed document. All relative links in the retained documentation resolve. The Rust audit exception rationale was consolidated into the root README and its configuration comment points to that retained section.
5. **Build and live verification — pass.** `npm run check` completed the TypeScript and Vite production build; 270 tests passed and 8 credential/mainnet-gated tests remained explicitly skipped. `npm run release:audit` passed across 246 bundle files. The live root, health, Futures, Stocks, and Convert discovery endpoints returned HTTP 200; health returned `ok`, GMTrade returned `ready`, and xStocks returned its complete 1,124-asset catalog.
6. **Security and artifact checks — pass.** `npm audit --omit=dev --audit-level=high` passed with three disclosed low-severity MagicBlock dependency findings. `cargo audit` passed with the six documented exceptions and 11 allowed maintenance/soundness warnings. No real `.env`, secret value, dependency tree, build output, Rust target, artifact, log, or PID is included in the intended Git tree. `.dockerignore` contains every required exclusion and the Dockerfile has no broad `COPY .` instruction.
7. **GitHub synchronization — pass.** The verified cleanup commit `01eb8e9` was pushed to `origin/main`. The post-push check confirmed a clean working tree, local `HEAD` equal to `origin/main`, and exactly the three required Markdown files in the committed tree. This embedded completion record is the sole follow-up documentation change.

## Completed plan: user-controlled AI agent access

**Status:** complete
**Date:** 2026-09-28
**Scope:** let an external AI agent request Convert, xStocks, and Futures actions against the user's existing Privy Solana wallet while requiring the user to approve and sign every value-changing transaction; fiat funding and arbitrary wallet operations remain unavailable to the agent

### Security model

The AI model never receives a wallet private key, Privy identity token, unsigned provider transaction, or general-purpose signing method. An agent receives a revocable, wallet-bound capability credential that can only create structured requests. Flay validates each request against the user's guardrails and places it in an approval queue. The authenticated user reviews the resolved venue, amounts, fees, slippage, leverage, and transaction details before the existing Privy wallet signs. The agent credential cannot approve, sign, submit, fund, export, transfer, or change its own policy.

### Implementation plan

1. Add shared, strictly typed agent policy, capability, intent, approval, execution, and audit-event contracts for Convert, xStocks, and Futures. Use deny-by-default schemas and reject unknown fields.
2. Build a bounded server-side agent store with hashed capability credentials, wallet and Privy-user ownership binding, expirations, one active policy revision per credential, request TTLs, idempotency, approval state transitions, revocation, and a capped audit trail. Never persist a plaintext credential.
3. Add an agent service that validates intent semantics and enforces user guardrails: enabled products, per-action approval, maximum USD value, rolling daily requested value, slippage, futures leverage, permitted token mints, stock symbols, futures markets, and credential expiry. Risk-increasing actions always require authenticated user approval.
4. Expose two separated API surfaces. User-management and approval routes require the existing Privy identity and wallet binding. The external submission route accepts only the agent capability credential and structured trading intents. Do not expose fiat funding, wallet transfer, arbitrary transaction, message-signing, key-export, MagicBlock, or policy-management tools to an agent.
5. Resolve approved requests through Flay's existing live providers and transaction builders. Reuse Convert, xStocks, Phoenix, and GMTrade validation, simulation, prepared-transaction expiry, signer binding, submission, and reconciliation paths rather than accepting transactions or venue output from the AI.
6. Add an Agent workspace to the authenticated application where users configure guardrails, create or revoke agent access, copy the credential once, inspect pending requests and history, reject requests, and approve requests. Approval must present a final review and invoke the user's existing Privy transaction-signing flow.
7. Make execution recovery explicit: expired, rejected, revoked, failed, and completed states remain visible; retry cannot duplicate a completed action; provider degradation preserves the approval record and returns a recoverable error.
8. Add focused service, schema, API-auth, policy, idempotency, fiat-denial, and UI tests. Confirm that an agent credential cannot call identity-protected fiat endpoints or obtain any general signing ability.
9. Update the root README with the final Agent architecture, supported capability boundary, configuration, API workflow, and trust limitations. Do not add another Markdown file.
10. Run the production build, complete test suite, release audit, dependency audit, tracked-secret/artifact scan, and safe live health checks. Compare every plan item and acceptance criterion with the final repository and embed the completion audit below this plan before declaring completion.

### Acceptance criteria

1. A user can create and revoke a wallet-bound agent credential and configure explicit Convert, xStocks, and Futures guardrails from Flay.
2. An external agent can submit only documented structured intents. All unknown action types, unknown fields, unsupported assets or markets, excessive amounts, leverage, slippage, expired credentials, revoked credentials, duplicate requests, and attempts outside the policy are rejected.
3. Every risk-increasing transaction requires a separate authenticated user approval and a Privy signature from the same embedded wallet. Possession of the agent credential alone can never move funds.
4. Convert and stock requests use live Flay aggregation and transaction validation. Futures requests use live Phoenix/GMTrade routing and their semantic transaction validators. The AI cannot provide a transaction or force a venue outside the reviewed route.
5. Fiat onramp, arbitrary send, MagicBlock, private-key export, message signing, policy mutation, approval, and transaction submission are absent from the agent capability surface and covered by negative tests.
6. Credentials are returned once, stored only as hashes, expire, are revocable, are rate-limited, and never appear in logs, activity payloads, URLs, or client persistence.
7. Pending approvals, policy status, credential status, execution results, failures, expiry, rejection, and revocation are clearly represented in an accessible responsive UI.
8. Existing Convert, Futures, Stocks, Funds, MagicBlock, wallet export, and gasless paths continue to pass their existing tests and production build.
9. README documentation and the embedded plan-to-code audit accurately describe what is cryptographically enforced, what Flay enforces server-side, and the fact that the user signs every value-changing action.

### Completion rule

Do not declare this Agent block complete until all supported actions execute through the same reviewed transaction paths as their manual counterparts, fiat and general wallet access are proven absent from the agent surface, the complete checks pass, and the plan-to-code audit has no pending criterion.

## User-controlled AI agent access audit

**Status:** complete
**Date:** 2026-09-28

### Plan-to-code comparison

1. **Contracts and deny-by-default parsing — pass.** `shared/agent.ts` defines the policy, capability, four supported intent shapes, approval states, prepared actions, execution results, workspace, and audit events. Strict discriminated Zod schemas reject unknown fields, unsupported kinds, invalid Solana addresses, invalid amounts, irrelevant futures fields, and policy combinations that cannot safely enable a selected product.
2. **Bounded capability and approval store — pass.** `server/agent/store.ts` generates a 256-bit one-time secret, retains only its SHA-256 hash, uses constant-time comparison, binds every record to the Privy user and Solana wallet, enforces credential and request expiry, caps credentials/requests/audit events, rate-limits credentials, detects conflicting idempotency reuse, records state transitions, and revokes access immediately. An identical retry returns the original request without consuming the rolling limit twice.
3. **Policy enforcement — pass.** `server/agent/service.ts` enforces product, token, stock, market, per-request USD, rolling 24-hour USD, slippage, leverage, position-count, credential-status, and expiry limits before preparing a transaction. Revocation is rechecked at review and execution. Expired provider preparations return to the queue for a fresh review.
4. **Separated API authority — pass.** Privy identity plus exact wallet binding protects credential management, workspace, review, rejection, and execution. Only `POST /api/agent/requests` accepts a capability bearer token. Its schema contains Convert, xStocks, Futures open, Futures close, and Futures cancel; fiat, send, MagicBlock, export, message signing, arbitrary instructions, policy mutation, approval, and direct submission have no capability route. An explicit unsupported-kind guard returns `AGENT_ACTION_NOT_ALLOWED`.
5. **Existing provider execution paths — pass.** Convert selects Flay's best live Jupiter/Raydium/Orca quote and uses `QuoteService.prepare/execute`; xStocks uses `StockService.quote` followed by the same validated market path; Futures obtains live Phoenix/GMTrade route quotes and uses `FuturesTransactionService.prepare/execute`. The agent supplies structured economic intent only and cannot supply transaction bytes or bypass the existing signer, semantic checks, simulation, prepared expiry, or reconciliation.
6. **Responsive Agent workspace — pass.** Desktop and mobile navigation expose guardrail configuration, one-time credential copy, revocation, policy summaries, approval queue, rejection, exact provider review, Privy approval, completion links, terminal request history, failures, expiry, and a wallet audit trail. The UI states that the agent cannot sign and that fiat/general wallet actions are unavailable.
7. **Recovery and idempotency — pass.** Pending, prepared, rejected, expired, failed, and completed states remain visible. Provider failures stay attached to the request; unexpired prepared actions are retryable; expired transactions are rebuilt only after returning to pending; completed actions cannot execute again; submitted sponsored swaps use the existing receipt-recovery path.
8. **Focused evidence — pass.** Seventeen Agent tests cover strict schemas, forbidden intents and fields, policy bounds, rolling limits, idempotent retries, credential hashing behavior, expiry, revocation before execution, wallet isolation, stale-transaction recovery, identity protection, fiat authentication denial, and pre-login/authenticated UI disclosures.
9. **Documentation — pass.** `README.md` documents the product surface, policy controls, human approval flow, request example, supported intent kinds, excluded powers, hash-only credential handling, and the current in-process/single-replica persistence boundary. No extra Markdown file was added.
10. **Repository and runtime verification — pass.** The final `npm run check` production build passed with 287 tests and 8 credential/mainnet-gated skips. `npm run release:audit` scanned 246 bundle files successfully. `npm audit --omit=dev --audit-level=high` exited successfully with only the three already documented low-severity MagicBlock transitive findings. RustSec loaded the current database and exited successfully with the repository's documented exceptions and 11 allowed warnings; registry yanked-package lookups timed out. Diff whitespace, tracked secret/artifact, and plaintext capability scans passed. A local production server returned health `ok`, identity-less Agent workspace access returned `401`, and a fiat intent returned `403 AGENT_ACTION_NOT_ALLOWED`. The existing live deployment returned health `ok` after its xStocks cache refresh.

### Acceptance-criteria result

All nine acceptance criteria pass. The same Privy wallet remains the sole signer; the AI agent can create policy-bounded trading proposals but cannot move funds by possessing its credential. Every value-changing Convert, xStocks, or Futures action reaches the existing exact transaction review and requires the authenticated user to approve it in Privy. Fiat funding and general wallet authority are absent from the capability surface and covered by negative tests.

## Completed plan: production MCP integration

**Status:** complete
**Date:** 2026-09-28
**Scope:** expose Flay's existing approval-gated agent capability through a production, framework-neutral Streamable HTTP MCP server that any conforming remote MCP client can discover and call without expanding the credential's authority

### Security model

MCP is a typed adapter over the existing agent service, not another execution authority. Every MCP request requires the same wallet-bound bearer capability before protocol initialization or tool discovery. Tools may read public Flay market catalogs and create only the four existing structured trading intents. The server never returns or accepts Privy identity tokens, transaction bytes, signatures, private keys, fiat actions, wallet transfers, arbitrary instructions, policy changes, approvals, or direct execution. Submitted proposals still appear in Flay's approval queue and require the authenticated user to review and sign in Privy.

### Implementation plan

1. Add pinned official Model Context Protocol TypeScript server and Node transport packages compatible with Node 22 and the repository's Zod version. Use Streamable HTTP, JSON responses, and a fresh stateless server/transport pair per request to prevent cross-client response leakage.
2. Mount a dedicated `/mcp` protocol endpoint before the JSON REST parser. Support required `POST`, `GET`, and `DELETE` behavior, bounded bodies, protocol-version negotiation, structured JSON-RPC errors, hardened response headers, and graceful handling of unsupported standalone streams in stateless mode.
3. Authenticate every MCP method, including `initialize` and `tools/list`, with the existing `Authorization: Bearer flay_agent_…` capability. Reuse constant-time credential validation, expiry, revocation, and per-capability rate limiting; never place the credential in URLs, logs, tool results, or server state.
4. Register a deliberately small tool catalog: `flay_get_tokens`, `flay_get_stocks`, `flay_get_futures_markets`, `flay_request_convert`, `flay_request_stock_trade`, `flay_request_futures_open`, and `flay_request_futures_manage`. Discovery tools use public read-only services. Proposal tools call the existing `AgentService.submit` policy engine and return request/approval status only.
5. Give every tool strict input schemas, bounded output, MCP annotations, clear units, and actionable errors. Mark discovery tools read-only; mark proposal tools destructive and non-idempotent at the protocol metadata level while requiring client-supplied idempotency keys for safe retries.
6. Publish safe MCP metadata and framework-neutral connection guidance without exposing credentials. Document the endpoint, Streamable HTTP transport, authorization header, official SDK example, protocol probe, and first-proposal flow.
7. Add protocol-level integration tests with the official MCP client transport. Cover initialization, authenticated tool discovery, public reads, proposal submission, policy denial, bad/missing/revoked credentials, unsupported methods, origin rejection, concurrency isolation, and proof that no forbidden tool or secret appears in the catalog/results.
8. Keep the REST capability API and all manual trading flows backward compatible. Run TypeScript, production build, full tests, release audit, dependency audit, tracked-secret/artifact scan, local MCP client smoke, and safe live regression checks.
9. Compare every plan item and acceptance criterion with the final repository, embed the completion audit below this plan, push the verified commit, deploy it to Railway, and verify standards-compatible MCP initialization and tool discovery on the live endpoint before declaring completion.

### Acceptance criteria

1. Any conforming MCP client can connect to `https://flay-production.up.railway.app/api/mcp` using Streamable HTTP and a bearer capability kept outside prompts and source literals.
2. Missing, malformed, expired, revoked, or wrong capability credentials cannot initialize a session or enumerate tools and receive bounded authentication errors without credential leakage.
3. The MCP catalog contains only the seven documented discovery/proposal tools; there is no fiat, send, export, signing, MagicBlock, approval, execution, arbitrary-transaction, or policy-mutation tool.
4. All proposal tools use `AgentService.submit`, enforce the same guardrails and idempotency as REST, return an awaiting-approval result, and cannot move funds without a later Privy identity plus wallet signature in Flay.
5. Streamable HTTP behavior is standards-compatible, safe under parallel clients, bounded against resource exhaustion, and does not share server or transport state across capabilities.
6. Tool schemas and responses clearly document atomic units, slippage basis points, leverage basis points, route choice, symbols, native IDs, request expiry, and the required human approval step.
7. The Agent UI, REST API, Convert, Stocks, Futures, Funds, wallet, MagicBlock, and existing gasless flows retain their prior behavior and pass the full repository suite.
8. README and `agent.md` accurately document setup, trust boundaries, limitations, test evidence, and deployment verification without adding another Markdown file.

### Completion rule

Do not declare MCP complete until an official MCP client successfully initializes against the release build, lists exactly the intended tools under capability authentication, submits a policy-bounded proposal that appears in the approval workflow, the deployed endpoint proves the same release and authentication boundary without disclosing a user-held capability, all forbidden authority remains absent, and the full plan-to-code audit passes.

## Production MCP integration audit

**Status:** complete
**Date:** 2026-09-28

### Plan-to-code comparison

1. **Pinned official SDK and isolated transport — pass.** `@modelcontextprotocol/server`, `@modelcontextprotocol/node`, and the test-only official client are pinned at `2.1.0`. `server/agent/mcp.ts` creates a fresh stateless MCP server and transport for each request, returns JSON responses, disables subscriptions and keep-alives, and caps request bodies at 48 KiB. A clean install with npm 10, the version used by the deployment image, passed after the lockfile was regenerated with its required nested Zod 3 peer entries.
2. **Dedicated protocol endpoint — pass.** The MCP handler is mounted at the acceptance criterion's public endpoint, `/api/mcp`, before Express's REST JSON parser. `POST`, `GET`, and `DELETE` reach the official Streamable HTTP handler; other methods return a bounded JSON-RPC `405` with the allowed methods. Unsupported stateless streams and session deletion fail cleanly without exposing internal state.
3. **Capability authentication and resource bounds — pass.** Every protocol request, including initialization and discovery, requires the existing bearer capability. Authentication reuses hash-only constant-time validation, wallet binding, expiry, and revocation. The MCP layer applies a capability-scoped limit of 120 requests per minute with at most 2,000 in-memory buckets, checks same-origin browser requests, rejects credentials in URLs, and returns `no-store`, hardened headers, and bounded structured errors. Neither credentials nor identity tokens enter logs or tool results.
4. **Seven-tool authority boundary — pass.** The catalog contains exactly `flay_get_tokens`, `flay_get_stocks`, `flay_get_futures_markets`, `flay_request_convert`, `flay_request_stock_trade`, `flay_request_futures_open`, and `flay_request_futures_manage`. Reads return bounded public provider data. Proposal tools delegate to `AgentService.submit`; there is no fiat, send, key export, signing, MagicBlock, approval, execution, arbitrary transaction, or policy-mutation tool.
5. **Strict schemas and human approval — pass.** The MCP tools reuse the Agent service's strict Solana-address, u64 amount, stock-symbol, stock-amount, and futures-market schemas. They reject unknown fields and invalid order semantics, document atomic and basis-point units, require UUID idempotency keys, expose route choice and provider-native IDs, and mark read/proposal behavior through MCP annotations. Successful proposals return their request status and expiry plus `fundsMoved: false` and `humanApprovalRequired: true`; only the authenticated user's later Privy review and signature can move funds.
6. **Framework-neutral product and documentation — pass.** The Agent credential dialog shows the Streamable HTTP endpoint and Authorization header without persisting the one-time credential. `README.md` documents generic MCP connection setup, an official TypeScript client example, the exact catalog, safe credential handling, the proposal workflow, and excluded authority. The architecture and wording apply to any conforming MCP client and add no framework-specific dependency.
7. **Official-client and negative evidence — pass.** `server/agent/mcp.test.ts` starts the actual HTTP API and uses the official `Client` plus `StreamableHTTPClientTransport` to initialize, list exactly seven tools, read token metadata, submit a futures-management proposal, and find that proposal in the user's approval workspace. Parallel clients with different product policies remain isolated. Tests also cover policy denial, missing, malformed, expired and revoked credentials, foreign origins, unsupported methods, standalone GET/DELETE behavior, oversized requests, forbidden tool names, and credential absence from catalogs and results.
8. **Regression, release, and security checks — pass.** A clean npm 10 install succeeded. `npm run check` completed TypeScript checking, the production Vite build, 49 passing test files, 290 passing tests, and 8 explicitly skipped credential/mainnet-gated tests. `npm run release:audit` scanned 246 bundle files successfully. `npm audit --omit=dev --audit-level=high` exited successfully with only the three previously documented low-severity MagicBlock transitive findings. The tracked artifact, plaintext credential, secret, and diff checks passed; the earlier RustSec audit remained successful with the repository's documented exceptions and allowed warnings.
9. **Deployment and live boundary — pass.** Commits `0b4ed07` and `323b77e` were pushed to `origin/main`. Railway deployment `39e3e05c-a828-4e01-9355-9c23c4c482ee` completed successfully. The live health endpoint returned `ok` and advertised `Model Context Protocol · Streamable HTTP · /api/mcp`; a live initialize request without a capability returned JSON-RPC `401 AGENT_CREDENTIAL_REQUIRED` with `WWW-Authenticate: Bearer realm="Flay MCP"`, a malformed capability returned `401 AGENT_CREDENTIAL_INVALID`, and a foreign Origin returned `403 ORIGIN_REJECTED`. Authenticated official-client discovery and proposal flow were proven against the same release build locally without copying a user-held capability into automation.

### Acceptance-criteria result

All eight acceptance criteria and all nine implementation items pass. Any standards-compatible remote MCP client can use Flay's Streamable HTTP endpoint with a user-created capability. That capability remains an in-process, single-replica, revocable proposal credential, so a deployment invalidates existing credentials and the user must create a new one. It can discover bounded public data and create guardrail-checked Convert, xStocks, and Futures proposals; it cannot approve, sign, submit, fund, transfer, export keys, mutate policy, or move funds. The user's Privy wallet remains the only transaction signer.

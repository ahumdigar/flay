# Flay GMTrade adapter

This private child process is Flay's non-signing bridge to GMTrade. It accepts bounded JSON Lines on stdin, writes one JSON response per line to stdout, and never opens a server port. Supported commands are `health`, `markets`, `quote`, `portfolio`, and `prepare_action`.

The build pins `gmsol-sdk` 0.10.0 and the Cargo lockfile pins every transitive crate checksum. The current RustSec exceptions and their reachability analysis are documented in [`apps/web/ADVISORY_REVIEW.md`](../../apps/web/ADVISORY_REVIEW.md); `.cargo/audit.toml` acknowledges exactly those reviewed IDs so new advisories still fail the scan. `src/main.rs` records reviewed upstream source revision `7ce035b41a266cb5ddb0192e5d29deb0c7e67a72`, program ID, upgradeable-loader programdata address, programdata SHA-256, and upgrade slot. Health reads those accounts from mainnet; a mismatch prevents Flay from enabling new GMTrade entries.

```sh
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo build --release --locked
cargo audit
```

Set `SOLANA_RPC_URL` to a mainnet RPC with account, transaction-history, lookup-table, and simulation methods. The process accepts wallet public keys only, uses Solana's `NullSigner`, never accepts a private key, and never submits a transaction. Only markets whose long and short tokens are both native USDC are exposed, so collateral-swap paths cannot enter the shipped application.

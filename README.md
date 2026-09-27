# Flay

Flay is a self-custodial Solana trading aggregator built one product block at a time. Stocks uses the official xStocks Solana catalog and Jupiter-only market execution with correct Token-2022 scaled-share accounting. Eligible Jupiter market swaps use Jupiter-managed sponsorship. Eligible Raydium and Orca SPL-to-SPL market swaps with existing token accounts use Privy's managed sponsor, and Funds includes a tightly bounded Privy-sponsored mainnet USDC send to recipients whose USDC account already exists. Privy supplies the exportable embedded Solana wallet and signs every transaction. Flay deploys no custom Solana program, runs no sponsor wallet, and charges no application fee.

- [Active xStocks plan](HACKATHON_XSTOCKS_PLAN.md)
- [xStocks provider research](XSTOCKS_INTEGRATION_RESEARCH.md)
- [xStocks completion audit](XSTOCKS_COMPLETION_AUDIT.md)
- [Active minimum gasless plan](HACKATHON_MINIMUM_GASLESS_PLAN.md)
- [Active gasless USDC send plan](HACKATHON_GASLESS_USDC_SEND_PLAN.md)
- [Active Raydium and Orca gasless Convert plan](HACKATHON_RAYDIUM_ORCA_GASLESS_PLAN.md)
- [Raydium and Orca gasless completion audit](RAYDIUM_ORCA_GASLESS_COMPLETION_AUDIT.md)
- [Exact SOL affordability fix plan](HACKATHON_EXACT_SOL_AFFORDABILITY_FIX_PLAN.md)
- [Exact SOL affordability fix audit](EXACT_SOL_AFFORDABILITY_FIX_AUDIT.md)
- [MagicBlock real authorization plan](MAGICBLOCK_REAL_AUTHORIZATION_PLAN.md)
- [MagicBlock real authorization completion audit](MAGICBLOCK_REAL_AUTHORIZATION_COMPLETION_AUDIT.md)
- [MagicBlock live-readiness audit](MAGICBLOCK_LIVE_READINESS_FIX_AUDIT.md)
- [Preserved Futures plan](HACKATHON_FUTURES_PLAN.md)
- [Current Futures plan-versus-code audit](FUTURES_COMPLETION_AUDIT.md)
- [Founder-signed Futures acceptance record](FUTURES_SIGNED_ACCEPTANCE.md)
- [Preserved Convert plan](HACKATHON_CONVERT_PLAN.md)
- [Preserved Convert audit](CONVERT_COMPLETION_AUDIT.md)
- [Preserved broad platform gasless plan](HACKATHON_GASLESS_PLAN.md)
- [Web setup and deployment](apps/web/README.md)
- [Dependency advisory review](apps/web/ADVISORY_REVIEW.md)
- [Long-term technical design](TECHNICAL_DESIGN.md)

Phoenix public market data is available before setup, and Flay uses Phoenix's official no-referral public onboarding transaction for the connected wallet. GMTrade runs through the pinned, non-signing Rust sidecar in `services/gmtrade-adapter`; the user’s Privy wallet remains the only user transaction signer. MagicBlock PER stays separate from Futures because third-party venue positions remain public on Solana.

The Privy-sponsored blocks remain under their hard completion gates until deterministic checks and founder-controlled mainnet transactions pass. Privy sponsorship must be enabled for Solana mainnet with conservative account caps. Flay calls a sponsored action confirmed only after validating the reviewed token movement, external fee payer, and zero sender SOL debit onchain.

# Flay Convert: real hackathon release

**Status:** active implementation scope  
**Budget constraint:** no more than USD 10 of founder-funded on-chain test capital  
**Deployment rule:** Flay deploys no Solana program in this release

## What ships

This release is a live Solana application, not a simulated trading demo. Users authenticate with Privy, receive an exportable embedded wallet, deposit their own assets, sign transactions in the browser, and receive Solana Explorer links for confirmed activity. Flay never receives a private key and never holds pooled user funds.

### Contract-free MagicBlock PER account

Convert includes an optional MagicBlock token account built on MagicBlock's already-deployed Ephemeral SPL Token and Private Payments infrastructure. Flay does not deploy a Solana program. From the Wallet surface, an authenticated user can:

- deposit a supported SPL token from the embedded Solana wallet into its MagicBlock ephemeral balance;
- authenticate a protected balance read by signing MagicBlock's one-time challenge;
- transfer from the ephemeral balance only through permissioned PER;
- withdraw the ephemeral balance back to the same embedded Solana wallet; and
- see whether a signed transaction must be submitted to Solana or the MagicBlock ephemeral RPC before approving it.

Every builder response is treated as untrusted. Flay validates the required signer, transaction fee payer, transaction lifetime, requested owner/mint/amount, allowed program IDs, submission network, and the unchanged signed message before relaying it. The user's Privy wallet signs every challenge and transaction. MagicBlock authorization tokens stay server-side in short-lived memory and are never logged.

The interface must not describe a regular Solana balance and an ephemeral balance as literally the same on-chain account. Deposit and withdrawal connect two balances. Transfers in this surface use only PER, which protects permissioned state and relies on MagicBlock's Intel TDX execution. Solana deposits, withdrawals, public DEX swaps, and any information committed publicly remain observable.

This account is a supporting Convert custody rail, not a replacement trading venue. The existing Jupiter, Raydium, Orca, and Jupiter Trigger transactions continue to execute on Solana. The UI must not claim that MagicBlock makes those venue swaps faster, cheaper, or private. MagicBlock's current private-swap builder is not used as a substitute for Flay's three-route market comparison in this block.

### Market Convert

Flay requests executable exact-input quotes from Jupiter Swap V2, direct Raydium routes, and direct Orca routes. It normalizes expected output, minimum output, venue fees, network cost, price impact, quote age, and transaction requirements. The UI recommends the best eligible result and keeps the other live routes available for manual selection.

The selected provider builds the transaction. Before asking the wallet to sign, Flay validates the payer, input/output mints, recipient, amount, minimum output, and every invoked program against the selected quote. It simulates the transaction where the provider path permits it. The user pays the ordinary venue and Solana fees directly.

### Limit Convert

The hackathon release uses Jupiter Trigger V1 instead of a Flay-owned vault. Jupiter builds the create, execute, status, and cancel transactions; the user's wallet signs them. Open order funds are governed by Jupiter's deployed order program, and cancellation returns unfilled tokens to the maker. Flay charges no additional fee.

Trigger V1 is still available but receives critical-only maintenance while Jupiter focuses development on V2. We are choosing it for this release because V1 uses existing on-chain order accounts and accepts a USD 5 minimum. Jupiter Trigger V2 is actively developed, but its current flow uses a Privy-managed custodial vault and requires a USD 10 price order, which does not fit Flay's hackathon custody and capital constraints.

The UI must identify this dependency as `Limit execution by Jupiter Trigger`, show the protocol fee and order minimum, and explain where funds reside. It must support create, open-status refresh, filled history, expiry, cancellation, and recovery. If live integration proves that V1 can no longer meet these requirements, the Limit tab stays unavailable with a truthful reason; it is never replaced by a simulated order or an automatic trade controlled by a Flay server key.

## Cost profile

| Item | Founder cost for the hackathon release |
| --- | ---: |
| Flay smart-contract deployment | USD 0 |
| MagicBlock program deployment | USD 0; Flay uses MagicBlock's deployed token programs |
| MagicBlock private PER transfer | Provider-built fees are shown at review; Solana deposit/withdrawal fees remain separate |
| MagicBlock ephemeral session and commits | 0.0003 SOL per session and 0.0001 SOL per commit after the first when applicable |
| Jupiter API | USD 0 on the 1-request/second free plan |
| Privy | USD 0 below 500 monthly active users |
| RPC and web deployment | Already funded separately |
| Mainnet test capital | USD 5–10, recoverable except for normal fees, slippage, and market movement |

The test wallet keeps a small SOL balance for transaction fees and uses the remaining value for one small SOL/USDC market conversion and a qualifying Trigger V1 order. Test capital remains wallet or order principal; it is not a software-service charge. Do not use the entire wallet balance in a trade.

## Release acceptance

Convert is ready for the hackathon only when all of these pass against live mainnet infrastructure:

1. Google or email sign-in creates the same exportable Solana wallet on return visits.
2. The user can copy the receive address and see confirmed SOL and token balances.
3. Live Market quotes display provider, age, output, minimum received, fees, and price impact.
4. At least Jupiter plus one genuinely direct Raydium or Orca route completes end to end. All three adapters remain the target, but an unavailable pool is labeled accurately rather than fabricated.
5. Review re-quotes and validates the exact transaction before the wallet signs.
6. A small-value swap confirms on Solana, and the activity record reflects actual wallet deltas.
7. A real Jupiter Trigger V1 order can be created, observed, canceled, and recovered. A fill is tested if price conditions and the USD 10 total capital ceiling permit it.
8. Wrong mints, stale quotes, inadequate balances, unsupported Token-2022 extensions, rejected signatures, failed simulation, expired blockhashes, and RPC/provider outages produce actionable states.
9. No Flay API key, wallet secret, signed transaction, or authentication token appears in logs or client bundles.
10. The interface says which parts are provided by Jupiter, Raydium, Orca, Privy, and the RPC provider.
11. MagicBlock health and supported-mint status are checked live; an unavailable or uninitialized mint is disabled with a truthful reason.
12. A wallet-authenticated MagicBlock challenge/login returns a protected ephemeral balance without exposing the bearer token to the browser or logs.
13. Deposit, private PER transfer, and withdrawal builders return real unsigned transactions; Flay validates them before signing and submits unchanged signed bytes to the response-designated network. No public ER transfer control or API action ships.
14. The MagicBlock UI distinguishes Solana and ephemeral balances and explains PER, TDX trust, settlement visibility, fees, and provider custody boundaries without exposing an ER mode.
15. Deterministic tests exercise the PER-only MagicBlock lifecycle without spending funds. The current provider API is validated against its initialized mainnet USDC builder; a founder-signed mainnet lifecycle stays inside the total USD 10 capital ceiling and uses the smallest provider-supported amount. Flay does not fabricate a devnet path where the provider does not expose an initialized equivalent mint.

This definition gives judges and users verifiable transactions and recoverable orders while keeping Flay's own financial authority at zero.

## After funding

The long-term Flay limit vault remains a separate upgrade. It begins only after funding covers development, an independent audit, remediation, mainnet deployment, a multisig upgrade authority, keeper monitoring, and an emergency cancellation path. Existing Jupiter-backed orders continue to be manageable during any future migration; they are never silently moved into a Flay program.

## Primary references

- [Jupiter Swap V2](https://developers.jup.ag/docs/swap)
- [Jupiter Trigger V1 overview](https://developers.jup.ag/docs/trigger/v1/index)
- [Jupiter Trigger V1 create order](https://developers.jup.ag/docs/trigger/v1/create-order)
- [Jupiter Trigger V1 cancellation](https://developers.jup.ag/docs/trigger/v1/cancel-order)
- [Jupiter API plans](https://developers.jup.ag/docs/portal/plans)
- [Jupiter Trigger V2 custody and minimum](https://developers.jup.ag/docs/trigger)
- [Privy pricing](https://www.privy.io/pricing)
- [MagicBlock Ephemeral SPL Token API](https://docs.magicblock.gg/pages/ephemeral-spl-token/api-reference/introduction)
- [MagicBlock private payments](https://docs.magicblock.gg/pages/ephemeral-spl-token/guides/private-payments)
- [MagicBlock fees, commits, and refunds](https://docs.magicblock.gg/pages/ephemeral-rollups-ers/introduction/fees-and-commit-economics)

# Global V2 completion and release safety gates — 13 November 2026

**Current classification:** independently deployed BNB **Testnet** prototype only, no real-fund approval. The old Global contract and its liabilities have **not** been deleted, satisfied or migrated. New contract V2: `0xA98D8d3709f5D3730BAD5d76C334731784e7CF07`. Never redirect old contract financial worker or API wallet key to this address.

## Source-complete functions and truthful boundaries

- V2 contract: 3% profit withdrawal fee, manual reinvest, user-signed 24h check-in, admin-authorized withdrawal approval, separate KYC admin role, gas-bounded 4-level personal/referral settlement **only after actual reward funding**.
- Website: classic V2-only user panel, exact network/bytecode pin, user financial details, administrator user dossier with BNB and USDT, typed-wallet + human-reviewed KYC decision, exact withdrawal queue approval/rejection with auditable standardized reason hash.
- Read-only recent wallet events: personal and referral credits, referrer wallet, level, rate and on-chain transaction/proof. **This is an explicitly bounded confirmed block window**; an empty window does not prove that the full history is empty.
- Separate durable raw V2 event indexer: `scripts/global-v2-history-indexer.mjs`. Canonical checkpoints, SQLite WAL, reorg overlap and chain 97/code-hash guard; no signer. This is initially **not installed**, and raw storage is not yet a fully reconciled historical financial reporting backend.
- `scripts/global-v2-readonly-audit.mjs --check`: does not submit transactions; reports on-vault cash, principal and profit liabilities in BNB/USDT, independently, and flags shortages. **Off-vault operations holdings are not counted**.

## Important incompatible user expectations

An initial 10,000-unit credit for 100 wallets creates 1,000,000 units of recorded principal claims. Adding only 500,000 mock units of vault cash cannot satisfy 1,000,000 units of principal claims, and fee routing to external wallets makes the shortfall worse unless the operators independently and enforceably replenish the principal backing. The successful 100-account Ganache tests use **MOCK ERC20, not real USDT or real users on public BNB Testnet**. Tests do not authorize synthetic account credits or fake reserves on public screens.

A smart contract cannot autonomously fetch independent business profit, mint honest real USDT, automatically sign future transactions, perform human KYC or guarantee cash withdrawals. A revenue funder and independent evidence verification remain necessary.

The V2 prototype contract already deployed is **immutable**. Its publicly callable deposit function transfers incoming funds with the old 10/10/80 routing and does not retain equivalent principal cash. Hiding the deposit button is a UI safety measure only. **Do not solicit real deposits, publish yield promises, or route wallet approvals to this unaudited vault.** If full enforceable principal backing is the policy, a separately audited collateral-backed vault implementation and an explicitly approved deployment/migration are needed.

## Release checks (read-only unless --install is explicitly invoked)

1. Pin the reviewed GitHub release commit in a detached checkout. Ensure front-end / Node / isolated mock tests are green.
2. Connect to the existing VPS using an authorized terminal, keep all private keys and env files private, and perform `bash ubuntu-global-v2-site.sh --check` with `GLOBAL_V2_EXPECTED_SHA` pinned to the reviewed checkout.
3. If the installed website is reviewed and rollback-approved, run the **frontend-only** `bash ubuntu-global-v2-site.sh --install`. It does not switch the old API, deploy a new contract, reset users, enable deposits, modify signers or run a payment bot. Inspect `V2_SITE_ONLY_INSTALLED`, `BACKUP_PATH`, exact HTML served and the V2 contract explorer link.
4. Run `node --env-file=/etc/globaldroptrade/trades.env scripts/global-v2-readonly-audit.mjs --check`. Inspect its `GLOBAL_V2_READONLY_AUDIT` report. Exit code 2 means an on-vault liability shortage; it is **not a command error** and **must block any production money launch**.
5. For the separate raw event-history service, first run `node --env-file=/etc/globaldroptrade/trades.env scripts/global-v2-history-indexer.mjs --check`. `--sync` writes ONLY the new root-protected `/var/lib/globaldroptrade-v2/events.sqlite`; do not enable a recurring timer until first backfill, reconciliation, rollback and archival policy are verified. The legacy journal is not imported and cannot be discarded.
6. With consenting **test wallets only**, verify live BNB Testnet registration, 24-hour expiry, independent manager KYC, revenue-funded personal and all four-level referral events, manual reinvest, 72h withdrawal requests and 3% after explicit manager approval. Preserve actual tx receipts. Check testnet RPC availability, code hash and low gas account.
7. Obtain independent Solidity audit and economic model review, transparent revenue custody, complete liability reconciliation, legal/regulatory and privacy review, KYC secure case-management evidence and emergency procedures. Real capital onboarding is **blocked** until all these pass.

## Zero-invention reporting rules

- Never claim the 100 mock users exist as public-chain wallets or the 500k mock treasury was actually sent to the live contract.
- Never label registered principal as cash available for payout.
- Never label a funded profit accounting credit as a wallet transfer.
- Never claim bounded event-history pages are lifetime complete.
- Never remove or overwrite old contract user claims to make V2 look populated.
- A signed wallet KYC boolean is an admin decision, not proof that underlying identity records were verified.
- A green CI build verifies assertions in those tests; it is not a third-party security, financial or legal audit.

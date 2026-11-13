# Global V2 — isolated BNB Testnet deployment gate

## Scope and safety

This runbook is **testnet-only, new-contract-only**. It must not change the existing live Global Drop Trade site at `globaldroptrade.com`, the legacy chain-97 contract `0x4C0F6141b18971db4b14e45c0bE8CddB09febc14`, previous users, deposits, profit credits, Epoch journal, reward timer, wallet approvals, or DNS.

The deployed candidate is `GlobalV2Prototype`. **It is not audited or production-ready.** Its inherited 10%+10%+80% deposit routing credits full gross user principal but leaves insufficient principal cash in the contract. Real-money onboarding and switching the current site must remain disabled until fully collateralized claims/custody, four-tier rate specification, security review, migration protocol and UI are approved.

All financial transactions in the source are performed only against a new address, after explicit opt-in, and are denied on mainnet (chain 56). `--check` reads the network but never loads a private key or sends a transaction. `--deploy` broadcasts **one real contract creation transaction** on chain 97, charges **testnet BNB gas** and requires a root-only signer file. Do not run it on a production/mainnet release.

## Release prerequisites

- Root access in the existing VPS shell (not a ChatGPT remote shell). No private key/seed pasted into the chat.
- Git checkout of one **reviewed, pinned commit SHA** of this PR, not moving `main`, not a branch whose contents can change after review.
- Node 22.23.3 (existing installation: `/opt/globaldroptrade-node/node-v22.23.3-linux-x64/bin`), npm dev dependencies (Solidity 0.8.30), adequate disk/inodes.
- Root-owned `/etc/globaldroptrade/trades.env` with active chain 97, vault pointing to old `0x4C0F...`, and working testnet RPC. Do not change it.
- Root-owned mode 600 `/etc/globaldroptrade/new-deployer-testnet-v1/deployer.key` corresponding to the **testnet deployer** address in `config/new-deployer-testnet.json`; testnet gas only. The CLI never prints the key.
- Configured token + mock/testnet feeds must have code and fresh, positive oracle rounds.
- Existing V2 marker absent at `/var/lib/globaldroptrade/v2-prototype/deployment.json`. If present, use `--verify` or investigate the existing tx; **never delete the marker to force another deployment**.
- CI: isolated Solidity compilation, 13+ financial tests and deployment preflight/role tests green; current PR remains Draft until separately reviewed.

## Preparation (does not deploy)

```bash
set -euo pipefail
export PATH="/opt/globaldroptrade-node/node-v22.23.3-linux-x64/bin:$PATH"
node --version
df -h /
df -Pi /
# Run in the reviewed, pinned Global V2 repository checkout:
npm ci --no-audit --no-fund --ignore-scripts
node scripts/compile-global-v2.mjs
node --test --test-concurrency=1 test/global-v2-prototype.test.mjs test/global-v2-deployment.test.mjs
node scripts/deploy-global-v2-testnet.mjs --check
```

Expected `--check` success: `V2_TESTNET_PREFLIGHT` with `chainId:97`, known owner and deployer, `legacyUnchanged:true`, `feeBps:300`, `cooldownSeconds:259200`, compiled init/runtime size and bytecode hash.

If check fails, **do not run deploy**. Solve mismatched RPC/network, stale feeds, lack of dependency code, insufficient disk, or release/config drift first.

## Broadcast (only after preflight and final review)

```bash
# Executed in the same pinned release checkout, as root:
node scripts/deploy-global-v2-testnet.mjs --deploy
node scripts/deploy-global-v2-testnet.mjs --verify
```

The script derives one testnet contract address from the deployer nonce, verifies chain 97, old vault code, runtime dependency code and oracle status, signer address, gas upper bound (9m gas and 0.10 BNB), and minimum testnet gas balance. It signs the constructor tx offline, writes a private **pending proof** before broadcasting, waits for three confirmations and verifies the new contract's immutable configuration, KYC/withdrawal admin roles, 300 bps fee, 72h cooldown, empty accounts, and initial zero liabilities. It logs the TX hash and new contract address only after completion. On interruption, `--verify` checks the recorded tx and chain; the guard refuses another attempt to protect against duplicate deployments.

No interaction with the existing vault or its wallet signers beyond read-only verification; no deposits, profit funding, KYC modifications, user migrations, site switch or reward allocations are performed.

## After deployment

Record the tx hash, new vault address, block number, code hash, config values and release commit in an auditable testnet-only release registry. Independently confirm on an explorer. Test with consented test users and assets only; verify deposit routing, on-chain check-in, four referral tiers, funded revenue provenance, role separation, manual reinvest, manager-only withdrawal approval and 3% fee.

**Block all live user funds** until principal coverage is real and demonstrably enforceable. A $1000 principal claim after routing $200 to fee wallets and $800 to operations is not backed by vault cash. A matching on-chain accounting entry is not a guarantee of repayment. Consider a redesigned escrow/custody and independent legal/economic/security review before any public rollout.

## Recovery and audit

- `V2_DEPLOYMENT_ALREADY_STARTED_RECONCILE_FIRST` => do not retry. Run `--verify` and inspect the private marker with an authorized operator. A pending marker may represent a signed but unbroadcast tx; manual nonce/receipt reconciliation is required before deciding any action.
- `V2_ORACLE_UNAVAILABLE_OR_STALE` => do not silently spoof/refresh a price; verify the selected testnet feed.
- `V2_TESTNET_CHAIN_97_ONLY` => do not force mainnet or change chain identity.
- `V2_INSTALLED_SITE_MUST_STAY_ON_LEGACY_TESTNET` => installed site/contract differs; freeze and re-review.
- Unexpected gas or runtime post-state => stop, preserve evidence, and do not point any user interface at the new address.

No production site deployment or user migration is automatically authorized by this runbook.

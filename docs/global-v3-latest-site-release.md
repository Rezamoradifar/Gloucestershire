# Global V3 — newest Global website, TESTNET-only gated integration

**Do not use real funds.** This integration preserves the V2 website and old Global backend. It does not migrate a single V2 wallet, position, profit, journal or principal. The NEW V3 contract is an isolated BNB Testnet experiment; contractual accrued TEST-token claims are **not proof of business income or wallet cash**.

## Current implementation

The latest Global navy/gold shell includes a separate V3 mobile/desktop workspace, using the same Home / Positions / Team / History / Profile dock as V2. Screens cover actual V3 ledger principal, daily accrued test claims, profit-on-profit, referral claims, 24-hour check-in, TEST-token deposits, optional manual reinvestment, positions, bounded withdrawal history and manager-only request approval, on-demand funding and separate payout.

Before any V3 financial value is shown, the browser requires:
- Correct connected EIP-1193 wallet on BNB Testnet chain 97;
- A separately deployed, operator-pinned NEW V3 address;
- Actual successful contract-creation TX receipt pointing to that address, in a sufficiently confirmed block;
- Runtime bytecode keccak256 matching the pinned release hash;
- Exact valueless TUSDT token, documented fee receiver and original contract manager role.

Any invalid or missing check fails closed and shows no financial balances. All financial changes require separate user/manager wallet signatures and confirmed transactions. No automatic payments or private keys in the web bundle.

## Critical difference from V2

V3 retains 100% of **mock TEST-token** deposits inside the new vault. V2 routed 10%+10% to fee wallets and 80% to operations. These are **different economic terms**, not an upgrade to the immutable V2 at its existing address. V2 stays accessible at #v2-dashboard and its records have NOT moved.

User-triggered and hourly keeper-triggered **automatic profit-on-profit** on V3 requires recent user check-in, a qualifying 24-hour settlement interval and a gas-funded on-chain transaction, but no manager approval. No absent days are backfilled. A test claim may be unbacked by vault cash; the site explicitly displays total unfunded liabilities. Payout still requires request, manager approval, exact TEST-token escrow or protected existing cash and separately confirmed payment to the original beneficiary. No guarantees.

## Recovery after confirmed V3 deployment — NO second deploy

If the server console contains **V3_PUBLIC_TESTNET_DEPLOYED_AND_VERIFIED** and an actual receipt was saved at `/var/lib/globaldroptrade/v3-prototype/deployment.json`, the contract **already exists**. An ethers `provider destroyed; cancelled request eth_getTransactionReceipt` exception can occur during teardown of an older `TransactionResponse.wait(3)` polling listener after the successful deployment. That exception does **not** authorize re-deployment.

Use the existing code release, or fetch the new reviewed recovery release, then:

```bash
bash scripts/release-v3-testnet-and-website.sh --install-verified-site
```

The existing proof is mandatory and is checked against the public BNB Testnet chain-97 transaction receipt, actual deployed runtime hash, pinned compiled creation bytecode, original manager, fee wallet and exact mock token. If the on-chain proof fails, the installer stops before modifying the website; it will never fabricate an address or replay the deployment.

The `--deploy-testnet-and-install` path also now automatically detects an existing successful proof, **skips all signing/contract creation**, verifies it independently and starts the site installation. The earlier ethers `sent.wait(3)` listener has been replaced with bounded read-only receipt + block-height polling for any future testnet deployment. The static site only counts as installed after `V3_TESTNET_PRIMARY_DASHBOARD_INSTALLED` appears in the **systemd service journal**, not merely a service-start acknowledgment.

**Do not** delete the deployment proof, manually import owner keys, re-run `--init-deployer`, or send new mock tokens to create a second copy of the same contract.

## Staged deployment and release (root on the Global testnet VPS only)

1. In /opt/global-v3-auto fetch the reviewed GitHub commit and check its SHA. Run Node v22 from /opt/globaldroptrade-node/node-v22.23.3-linux-x64/bin (adapt only for correct architecture) and npm ci --ignore-scripts --no-audit --no-fund.
2. Read-only old deployer check: node scripts/deploy-global-v3-testnet.mjs --check-old-testnet-deployer. It verifies the pinned previous BNB TESTNET deployer address and remaining tBNB. If missing/insufficient, **do not force deployment**.
   **Android SSH confirmation:** When the deployment program prints `Type DEPLOY NEW V3 BNB TESTNET ONLY:`, type that phrase as input to the STILL-RUNNING program, **not** at the root shell prompt. The program safely retries up to five times when a pasted multi-line command has already supplied an empty newline. Until the exact phrase is accepted, no V3 deployment transaction or intent file is created. Never paste a private key or password into chat.
3. Only after reviewing positive check and confirming the isolated TESTNET deployment: node scripts/deploy-global-v3-testnet.mjs --deploy-old-testnet-deployer. Type exactly DEPLOY NEW V3 BNB TESTNET ONLY at the terminal. It signs a real **valueless testnet deployment only**, creates a one-time proof file and a V3-only keeper config. It does not change the live site or V2.
4. Read-only website release preflight: bash scripts/install-v3-site-when-verified.sh --check. It verifies the real deployed contract address, code hash, manager, fee receiver and transaction receipt; builds the web app and runs all tests, without changing the served website.
5. Only if all checks pass, use bash scripts/launch-v3-site-after-deployment.sh --install. A detached systemd one-shot executes the **existing backup/rollback-protected static site installer**. A final log must show V3_TESTNET_PRIMARY_DASHBOARD_INSTALLED, not merely V3_SITE_SERVICE_STARTED. The legacy V2 site and account data remain available. #dashboard becomes the new isolated V3 testnet view; #v2-dashboard opens existing V2, #v3-dashboard explicitly opens V3.
6. To make automatic accrual run unattended, create a disposable, separate BNB testnet gas-only keeper (bash scripts/install-global-v3-keeper-timer.sh --init-wallet), send it small valueless tBNB, then run --check and --install. The hourly job independently verifies the V3 deployment, only sends permissionless accrueDaily on due, eligible positions, cannot manage or approve withdrawals, and uses a fixed reviewed code release. Without this funded keeper **automatic on-chain posting is not operational**. Accounts still need an eligible 24-hour check-in.
7. Complete an independently observed public-chain TESTNET cycle: make a valueless test deposit, check-in, confirm on-chain daily/compound events, request the exact claim, manager approve, escrow enough real test tokens, pay original user, reconcile all receipts and outstanding claim/cash balances. No proof of public TESTNET payment exists until this test is done.

### Release no-go gates

V3 is NOT approved for BNB Mainnet or any real Tether or investment proceeds. Before production require independent professional smart-contract/security audit, economic sustainability/revenue evidence, fully documented liquidity and custody, user disclosures and applicable legal approvals. Passing CI or deploying a TEST contract is not a substitute for these controls. The design records potentially unfunded TEST-token claims, which is not equivalent to profit actually generated by business operations.

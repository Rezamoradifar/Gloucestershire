# Global V3 — permissionless daily and profit-on-profit accrual (TESTNET ONLY)

**Current status: isolated source code and local acceptance tests only. Not activated on the installed Global V2 website. Do not treat projected or accrued test claims as real USDT or guaranteed investment income.** V3 is independent of V2 vault, journals and customer balances.

## Approved test behavior

- **Automatic accounting:** Each eligible accrual runs once per qualifying 24-hour interval. The contract computes base daily accrual and profit-on-profit on the position's existing outstanding accrued-profit basis. Both components enter the same test transaction and are separately visible using claimableDaily and claimableCompound.
- **NO manager approval to accrue:** accrueDaily(user, position) is permissionless. checkInAndAccrue(positions) lets the user sign one activity transaction. A dedicated gas-only scheduled keeper can call accrueDaily when a period is due, without the user pressing reinvest and without any admin/funder role. A blockchain write still requires a signed gas-paying transaction.
- **Activity requirements:** users must have a valid check-in in the preceding 24 hours. Each position must have matured for 24 hours from its last accrual. **Missed days are not backfilled.** If the user does not check in, or if gas/network/service is unavailable, the contract will not create credits. The keeper runs hourly but no exact posting time is promised.
- **Profit-on-profit is not a new principal deposit:** automatic compounding uses outstanding accrued claims as the next calculation basis. The separate user-signed reinvest call remains optional and moves an existing claim into a locked principal position.
- **Withdrawals stay distinct:** the user requests, management approves, a real source wallet funds or reserves the exact gross amount, then the payout reaches the original beneficiary. There are no automatic withdrawals, fake token creation or initial million-token treasury seed.

The recorded, potentially unfunded test liabilities can grow without new incoming funds. The test percentages are not verified business returns or a guaranteed investment yield. Security, economic and legal audits remain mandatory before real-money use.

## Files

- contracts/v3/GlobalV3DeferredTestnet.sol — isolated new V3 contract with indexed members, accrued/compound claims and manager-only withdrawal approval.
- scripts/global-v3-auto-compound-keeper.mjs — gas-only permissionless accrual runner, bounded at most 100 accounts and 30 signed positions per run by default.
- scripts/deploy-global-v3-testnet.mjs — explicitly opted-in interactive BNB Testnet-only deployment, not a scheduled public deployment.
- scripts/install-global-v3-keeper-timer.sh — hourly systemd timer installer with isolated DynamicUser and signed credentials.
- config/global-v3-testnet-keeper.example.json — intentionally non-runnable before a real new deployed contract address/runtime code hash are pinned.
- test/global-v3-auto-compound-keeper.test.mjs and test/global-v3-deferred-ledger.test.mjs — isolated tests using mock assets.

## Operator deployment and automation steps

1. In a pinned V3 repository checkout, run npm ci --ignore-scripts --no-audit --no-fund, then node scripts/compile-global-v3.mjs. This ONLY compiles.
2. If no dedicated deployment signer exists, run node scripts/deploy-global-v3-testnet.mjs --init-deployer once. Enter a strong password at the hidden terminal prompt. It creates a new encrypted file /etc/globaldroptrade/v3-deployer-only-testnet.json and prints **only a public address**. Fund that address with a little **valueless tBNB**, never with user assets. Run node scripts/deploy-global-v3-testnet.mjs --check (read only). After explicit review, use node scripts/deploy-global-v3-testnet.mjs --deploy /etc/globaldroptrade/v3-deployer-only-testnet.json. Enter the password only in the interactive terminal, never in chat/GitHub, and type the exact confirmation.
### Reuse of previous isolated BNB Testnet deployer

The already-used **testnet-only deployer** was configured as `0xCf6Eb63ba4D2174CA2759eff57a720a54416b71d`. Its old root-owned testnet-only signing file may still exist at `/etc/globaldroptrade/new-deployer-testnet-v1/deployer.key`. The V3 deployment wrapper can now use **that same pinned signer**, but NEVER the V2 contract administrator or anyone else's wallet:

- Read-only check: `node scripts/deploy-global-v3-testnet.mjs --check-old-testnet-deployer`. This reports only the public address, fresh tBNB balance and projected gas, checks the original key-file permissions and wallet identity, and sends **no transaction**.
- If and only if the previous check succeeds and a fresh V3 deployment is explicitly intended on BNB Testnet: `node scripts/deploy-global-v3-testnet.mjs --deploy-old-testnet-deployer`. This requires an exact typed interactive confirmation. The key never appears in stdout, chat, GitHub, environment variables or an extra keystore.
- Contract V3 ownership remains with the separate manager `0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632`; the existing deployer gets **no administrator, funder or withdrawal rights** in V3 by deploying it.
- The original deployed V2 vault, token balances, financial journals and website are untouched. If the prior testnet key file is missing or does not match the pinned public address, deployment stops rather than attempting another wallet.
- This existing-signer path is intended for the valueless testnet only. Reusing a compromised old key is risky; do not add any real USDT, customer assets or privileged role to the deployer.

3. Successful public testnet deployment writes an operator-only receipt at /var/lib/globaldroptrade/v3-prototype/deployment.json and pinned root-only keeper config at /etc/globaldroptrade/v3-keeper-testnet.json. This does NOT change any deployed V2 address, site, user or contract balances.
4. From the V3 checkout, run bash scripts/install-global-v3-keeper-timer.sh --init-wallet once. It creates a NEW dedicated disposable BNB Testnet gas-only wallet and prints **only its public address**. Send only a small amount of valueless tBNB for gas, never real money, user assets or manager funds.
5. Run bash scripts/install-global-v3-keeper-timer.sh --check. It verifies the exact runtime code hash, network, test asset and eligibility without sending transactions. After passing, run bash scripts/install-global-v3-keeper-timer.sh --install to enable hourly execution.
6. Verify with systemctl status global-v3-compound-keeper-testnet.timer --no-pager and journalctl -u global-v3-compound-keeper-testnet.service -n 80 --no-pager -o cat. Confirm actual DailyClaimAccrued event logs on public BNB Testnet and compare daily versus compound claims and shortfall on the same block.
7. Before any site switch, complete controlled public testnet UI/payment acceptance, professional contract/economic audits, and user consent/legal review. Existing V2 is untouched.

The keeper rejects wrong chain, non-deployed or altered V3 bytecode, wrong token, privileged signer, ineligible user, gas overspend and malformed account data. It signs accrueDaily ONLY; it never approves, pays, mints or transfers any tokens.

## Operational risk boundaries

The gas-only signer is generated outside the repository, stored root-only, passed to the isolated service through systemd credentials and should hold only a little testnet gas. A rotating cursor bounds indexed-user work per run. Accounts exceeding the configured position limit block that run rather than silently losing history. Automated accrual is *not evidence of backed user profits*, and no production/mainnet release is authorized by this implementation.

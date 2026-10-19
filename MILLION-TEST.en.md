# One million test tokens across 20 accounts

This scenario deposits **1,000,000 new TEST USDT into 20 new test wallets, 50,000 each**, on the existing BNB Testnet contract. These tokens have no real dollar value. The contract and owner wallet remain unchanged; no owner key is required.

```bash
bash ubuntu-live-plan.sh /root/global-testnet-v071/.testnet-server million
```

The payer is the existing test deployer `0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2`. The allowed contract is `0x7f19354B765920B9b17003d0840EEaA133883DcA`, on chain 97 only. No keys need to be shared. Addresses and creation transactions are verified before interacting with the token or mock feed.

## Expected results

| Item | Test-token amount |
|---|---:|
| New accounts | 20 |
| Principal per account | 50,000 |
| Total new deposits | 1,000,000 |
| Operations wallet transfer | 800,000 |
| First fee wallet transfer | 100,000 |
| Second fee wallet transfer | 100,000 |

All accounts are direct children of the test wallet. Each branch adds 50,000 volume, totaling one million across 20 branches. The mock token price is set to $1 for the test. Under these parameters, exactly 50,000 qualifies for tier four; VIP begins at `50000 ether + 1`. The tool reads every threshold and stops before depositing if any changed. It does not grant VIP approval or seller profit.

These are **additional deposits**. Existing balances and previous test volume are not reset. Recording principal does not imply one million cash in the treasury: funds follow the existing 80/10/10 split.

## Budget and resumption

- Required initial tester balance: 0.08 tBNB, a conservative ceiling for transferred value plus maximum gas, not an exact fee.
- Each account receives 0.002 tBNB for gas, totaling 0.04 tBNB; some remains in test wallets.
- The tool stops above 1 gwei and enforces its total budget.
- It sends 81 transactions if the root is already registered, otherwise 82. It does not add a root deposit.
- Signed transactions are saved before broadcast in `million-test-v1/million-private.json`, which contains test keys and must remain private with mode 600.
- After interruption, repeat the same command. Wallet addresses, nonces and signed transactions remain fixed, preventing duplicate deposits. Do not delete the journal. A shared lock prevents concurrent use with the smaller scenario.
- After 24 hours the mock price may require review. Do not delete state to restart.

## Viewing the report

`MILLION_TEST_READY` marks report completion. `PUBLIC_REPORT_WRITTEN` confirms that public files were copied to the active, managed Nginx website root:

- `https://globaldroptrade.com/testnet-million.html`
- `http://104.167.16.102:8961/testnet-million.html`

The report includes all 20 addresses, amounts, deposit links and on-chain reconciliation results through the stated block. The account dashboard shows only the wallet selected in the browser. Public HTML/JSON excludes keys and raw signed transactions. The smaller report remains separately at `/testnet-plan.html`.

This scenario covers deposits and volume only, not reward claims, seller commissions, withdrawals or VIP behavior. Local Ganache tests do not establish public-chain execution; server execution and actual receipts are required.

```bash
node --test --test-concurrency=1 test/million-testnet.test.mjs test/live-plan.test.mjs test/live-health.test.mjs
```

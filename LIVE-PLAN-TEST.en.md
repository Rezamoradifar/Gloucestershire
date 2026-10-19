# Live plan test on BNB Testnet

This tool targets the historical contract `0x7f19354B765920B9b17003d0840EEaA133883DcA` on chain 97. It does not deploy a new contract, change the owner or rates, or require the owner key. Only the existing test wallet `0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2` is allowed.

## Server execution

Run as root from the matching checkout:

```bash
bash ubuntu-live-plan.sh /root/global-testnet-v071/.testnet-server
```

The script reads the existing key in place without copying or printing it. It creates two child test wallets. Their keys and signed transactions remain in `live-plan-v1/plan-private.json` with mode 600. Do not share this file or `deployer.key`.

The combined ceiling for transferred value and maximum fees is 0.03 tBNB. Each child receives 0.004 tBNB for gas. No real BNB or real USDT is used. This contract's TEST USDT comes from its MockToken; unrelated test tokens cannot replace it.

## Scenario and expected results

1. Verify the network, owner, seven partners, tokens and creation transactions against compiled deployment input.
2. Refresh this token's mock price to $1 for testing.
3. Deposit 100 tokens from the tester, 300 from the first child and 200 from the second. Reconcile each deposit against events and actual 80/10/10 transfers.
4. Put the two children in an independent reward group and fund a separate 35-token reward budget.
5. Prepare the $500 stage and claim 35. Exact consumed branch volumes are 300 and 200. A repeat stage attempt is rejected by `eth_call`; no deliberately failing transaction is sent.
6. Withdraw 10 profit tokens and verify 9.5 net plus 0.5 fee. Simulate an immediate repeat withdrawal at the receipt block and confirm rejection.
7. Reinvest five profit tokens. Relative to this scenario's start, principal increases by 105, remaining profit by 20 and withdrawal capacity by 10.5 tokens.

These test changes remain on the public test contract. Reward receipts, deposits and reinvestments occur in the scenario; deposits and reinvestments generate network volume according to the contract rules. The test wallet may already hold funds. The report verifies deltas and records total balances separately.

## Resumption and reports

Each transaction is stored **before broadcast** with a fixed nonce and signature. Repeat the same command after interruption; the submitted transaction is not recreated. A completed run sends no further transactions. Do not delete the journal or use this wallet concurrently in another transaction-sending tool. A shared lock prevents concurrent runs from different checkouts.

Success prints `LIVE_PLAN_READY` and the report path. Public `plan-public.json` and `plan-public.html` contain only addresses, results and transaction hashes. If a managed active website root exists, the script copies them to:

- `https://globaldroptrade.com/testnet-plan.html`
- `http://104.167.16.102:8961/testnet-plan.html`

This is a saved report through the stated block, with BscScan links. A later website installation creates a new release; rerunning this command republishes the completed report into the active release without new transactions. Nginx configuration is unchanged.

The wallet dashboard displays only the connected account. This report exposes the server's test accounts without importing their keys into a browser. It does not establish successful mobile-wallet connection or verification of a user's personal account view.

## Separate work required

- Seller profit settlement and upline activation require the owner or an authorized reporter. This tool lacks that authority and does not claim live seller-commission verification.
- This scenario checks only the first aggregation stage on the public network. All fourteen stages, VIP and the 90-day lock have separate local tests.
- Changed configuration, a paused contract, an existing cooldown, excessive gas price or insufficient balance stops execution. After 24 hours a mock price may expire and require review; preserve the saved state.
- Local Ganache execution does not prove public-chain execution. Only successful actual server receipts do.

## Development validation

```bash
node --test --test-concurrency=1 test/live-plan.test.mjs test/live-health.test.mjs
bash -n ubuntu-live-plan.sh
node --check scripts/live-plan-test.mjs
```

Tests cover successful execution, balances and net receipts, interruption after broadcast and resumption, duplicate prevention, rejection of mainnet/wrong provenance/owner signing, and exclusion of keys and raw transactions from public output.

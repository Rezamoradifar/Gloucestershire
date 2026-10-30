# Production automation and owner authority

Implementation package only. No mainnet deployment, operator permission, funding, private RPC configuration or service activation is asserted by this document. The ordinary contract and its economic rules are unchanged. `ubuntu-mainnet.sh` remains preparation-only.

| Operation | Authority and behavior |
| --- | --- |
| Personal profit | The authorized reporter worker computes the existing contract plan at each completed 24-hour period and submits funded, idempotent allocations. No daily owner confirmation. |
| Referral profit | The same plan computes eligible source-tier referral shares, separately funded in addition to personal profit. |
| Reinvestment | The customer chooses and signs reinvestment. Its principal enters the next eligible period-start snapshot; accumulated profit is not automatically compounded. |
| Network volume | The worker continues bounded on-chain propagation jobs from saved cursors. User claim actions remain user actions. |
| Withdrawal | The owner approves each request. The worker pays only approved requests; it cannot approve requests. A credit in the account is distinct from a wallet transfer. |
| Reward budget | Separate accounting, dashboard cash coverage and shortfall alerts; physical treasury cash remains shared. No principal reserve lock is introduced. |
| Owner capital | The existing owner may deploy all liquid treasury funds. Owner withdrawal authority and deposit routing are unchanged. |
| RPC fallback | Up to three private RPC files. Each candidate must pass production creation, runtime, canonical history and journal anchor proof. Waiting runs rotate candidates for the next cycle. |
| Background execution | A separate systemd timer runs independently of SSH sessions and checks every five minutes. It allocates 24-hour periods; it does not change the rate into an hourly rate. |
| Standby | A second host runs read-only checks without a key. Writer promotion is manual with the synchronized journal and a new primary machine binding. There is no automatic dual-writer takeover. |

## Calculation and timing

Rates, tiers, rank qualifications and referral eligibility remain those already in the deployed ordinary contract. For an eligible account whose tier rate remains 0.5%, reinvesting 50 into principal 100 makes the next eligible period's personal profit `150 × 0.005 = 0.75`. Crossing a tier boundary can change the contract's rate; this package does not rewrite tier rules.

Production uses the existing **global 24-hour period-start principal** policy. A deposit or reinvestment after a period starts joins a later snapshot, then earns when that full period finishes. This is not the testnet per-position anniversary schedule and does not promise a payment exactly 24 hours after every deposit. The production policy rejects hourly/testnet markers.

Missed periods retain their historical snapshots. At most two periods are processed per run, with bounded registration log pages and ten-block RPC slices. Allocation batch IDs and the contract's `usedRewardBatch` prevent duplicates after restarts. Signed bytes are saved before broadcast; an uncertain outcome resumes the same transaction rather than inventing another nonce. A pending or noncanonical transaction stops fresh writes.

## Cash and funding

Available cash for a new profit allocation is treasury cash minus existing allocated profits, fee reserves and queued profit claims. The worker also requires enough recorded reward budget for both personal and referral amounts. Existing principal claims are deliberately excluded from this cash lock calculation, preserving the owner's requested ability to work with liquidity.

The worker checks cash before new allocations and exposes shortfalls. This cannot guarantee cash coverage if the owner concurrently withdraws funds, and it does not prevent the owner from withdrawing cash after allocation. Insufficient funding waits without changing the contractual amount owed by the plan. Alerts appear in the management funding card and private worker status/journal output; no external notification service is configured.

## Activation prerequisites

1. Independently deploy and verify the ordinary pinned mainnet contract and constructor. This package does not perform that deployment.
2. Complete `config/production-automation.example.json` with actual chain-56 creation hash, deployer, vault, runtime hash, queue, deployment block, global start timestamp and dedicated operator. Place the completed manifest at `/etc/globaldroptrade/mainnet-automation.json`, root-owned mode 600. Place private RPC URLs in the listed root-owned mode-600 files; never commit them.
3. Grant the dedicated operator reporter authority through the existing governance process. This worker cannot grant itself authority, change rates or approve withdrawals. Never reuse the owner key as the automation key; the on-chain operator must be a separate address with only its intended role.
4. For a primary only, store its dedicated key at `/etc/globaldroptrade/mainnet-automation.key`, root-only mode 600. Bind `executionMachineId` to that host's `/etc/machine-id`. Supply BNB gas, reward budget and actual cash. The sample gas budget is a **cumulative maximum of 0.02 BNB**, not a guaranteed fee and not an unlimited allowance.
5. Install the existing managed Node 22.23.3 runtime under `/opt/globaldroptrade-node`. Run the read-only check, review the exact policy and funding report, then install the separate timer:

```bash
bash ubuntu-production-automation.sh --check /etc/globaldroptrade/mainnet-automation.json
bash ubuntu-production-automation.sh --install /etc/globaldroptrade/mainnet-automation.json
```

The example intentionally contains invalid placeholders; it cannot activate a service as-is. A primary install requires verified chain proof, reporter permission, gas and a matching dedicated key. A standby install never reads a key and schedules `--check` only. Existing testnet units and state are separate and untouched. The installer does not stop a running financial worker or rewind its journal.

Inspect with:

```bash
systemctl status globaldroptrade-mainnet.timer --no-pager
journalctl -u globaldroptrade-mainnet.service -n 50 --no-pager
```

Primary state is private under `/var/lib/globaldroptrade/mainnet-automation-v1/`: journal, lock and status. Back up the journal securely along with the activation manifest. An independent backup machine, backup transport, monitoring destination and verified private RPC subscriptions still require actual provisioning; this repository cannot assert they exist.

## Promotion and recovery

Never start a second writer just because the first host becomes unreachable. Fence the old writer first, take a synchronized private journal copy, verify every pending transaction's receipt or resume its identical signed bytes, and change only the execution host binding on the replacement. Preserve the contract/policy/operator binding and all confirmed entries. Do not delete pending transactions or reset epochs. Increasing a spent cumulative gas budget is an explicit operator configuration change, not an automatic top-up.

The production sender permits only `batchProfit`, approved queue `pay`, and bounded `processNetworkVolume`. It rejects owner fund transfers, approval, reinvestment, deployment and chain-97 saved transactions. Preparation checks never open the signing key. No live mainnet activation or end-to-end production payment is represented by local test results.

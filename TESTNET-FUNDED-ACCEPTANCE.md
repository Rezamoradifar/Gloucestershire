# Existing-account hourly acceptance test

This release applies the production cash-coverage calculation to the existing chain-97 worker. It preserves account data, the deployment, hourly position anniversaries, transaction journal, paid-hour cursors, reward batch IDs and owner capital authority. It does not deploy a contract, reset data or switch to mainnet.

Both paths use `rewardFunding` in `scripts/daily-profit.mjs`. `executeDailyPlan` checks all remaining batches before the first allocation and rechecks available cash before each batch. Existing profit, fee reserves and queued profit claims cannot be reused to back a new allocation. Recorded principal does not restrict owner withdrawals. Pending signed transactions are reconciled by the existing worker before new planning.

## Local evidence versus public-network evidence

`test/testnet-funded-worker.test.mjs` executes the actual hourly worker with the FastTestnetVault artifact on a local chain configured as 97. It covers personal and source-tier referral profit, voluntary reinvestment, restart/idempotency, owner cash deployment, funding recovery, approved withdrawals and a planning transport outage. These accelerated local tests do not prove that the public VPS RPC is healthy or that a live payout has happened.

## VPS installation

Use the reviewed commit containing this document. On the existing Ubuntu VPS, run:

```bash
bash ubuntu-sync-hourly-worker.sh --execute --wallet 0x2F980aC9ae92DB23cA2AEAd1CE8188A5764a7Bfa
```

This existing installer serializes the worker/failover transition, preserves journals and aligns their code. It must not interrupt an in-flight financial service. A busy lock, invalid creation receipt, missing historical state, insufficient gas or missing authority is a blocker, not a successful activation. Do not delete the journal or bypass verification to overcome it. The server command should run as a systemd transient unit so closing the terminal does not interrupt installation.

Successful source alignment is distinct from confirmed payments. Inspect the final audit and worker logs; retain errors for diagnosis. The frontend funding card was prepared separately and is not deployed by this worker-only installer. A separate standby machine still requires provisioning.

## Live acceptance sequence

1. Confirm chain 97, the connected vault and the saved policy `periodSeconds: 3600` and `basis: position-anniversary-principal`. Check existing paid hours and pending transactions before investing. No forced top-up or repeated million-token grant is part of this test.
2. With a registered, eligible parent, deposit 100 TestUSDT from a test customer. After the position's first complete hour and the next worker run, prove a 0.5 personal credit if its contract rate is 0.5%. An eligible parent receives the configured source-tier share; for this base tier 8% of 0.5 is 0.04.
3. Reinvest the customer's 0.5 voluntarily. Its original position earns 0.5 each eligible full hour; the new 0.5 position earns 0.0025 at its own hour anniversary. The resulting combined amount for complete matching hours is 0.5025. The two positions can be paid at different times when their anniversaries differ. Do not confuse a fixed percentage with a fixed dollar amount.
4. Add a separate 1,000 TestUSDT position and verify its own anniversary and actual tier rate. Under the unchanged base tier for that amount, 0.7% gives 7 TestUSDT per test hour, subject to the deployed rank rules.
5. Request a small profit withdrawal. Verify no wallet payment before owner approval; approve with the owner wallet, then prove automatic payment and the deployed fee. The worker never approves the request itself.
6. Close SSH and verify at least two further consecutive eligible payments from systemd logs and canonical credit receipts. Compare account changes and deterministic batch IDs; do not use the word Active as proof of payment.
7. Test an unavailable RPC on an isolated configuration or read-only probe. Verify a replacement endpoint passes chain, creation, history and canonical checks. Never deliberately corrupt an in-flight signed transaction or delete progress on the public worker.

Before mainnet, also complete a 24-hour ordinary-contract timing test with its global period-start snapshot policy. Hourly position-anniversary tests alone do not validate the different production timing rule. Capture exact expected/actual principal, rate, credit, referral, fee and receipt for each case. Mainnet activation remains a separate step after all public-network evidence is verified.

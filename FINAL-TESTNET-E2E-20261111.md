# Final BNB Testnet E2E gate — 2026-11-11

This is the last testnet qualification package before the reviewed mainnet
launch sequence. It keeps all public-chain user actions on BNB Testnet chain 97
and never treats test tokens as real money.

## Target

- Chain ID: `97`.
- Current replacement testnet vault:
  `0x4C0F6141b18971db4b14e45c0bE8CddB09febc14`.
- Existing isolated testnet automation and activity policy.
- Existing testnet journal and catch-up state. Nothing is reset.

## Automated gate

Run from a clean pinned checkout:

```bash
bash ubuntu-final-testnet-e2e.sh --all
```

The local phase recompiles the replacement testnet contract and runs the
deterministic EVM coverage for:

- funded hourly test rewards;
- personal profit;
- referral profit;
- reinvestment;
- daily activity eligibility;
- approved withdrawal payment;
- restart and no-replay behavior;
- signer-free index catch-up;
- interrupted/resumed indexing;
- private-key wrapper failure handling.

The live phase is read-only. It validates the public API configuration,
automation identity and freshness, absence of blockers, and a prior profit credit
receipt on the configured chain-97 RPC. Each receipt must be successful,
canonical, sufficiently confirmed and contain a ProfitCredited event from the
expected vault. The completed signer-free catch-up file and active isolated
testnet timer are also required. It does not open a wallet or send a transaction.
A previous receipt does not prove that a new credit was made during this test.

Required final output:

```text
FINAL_TESTNET_LOCAL_E2E_PASS
FINAL_TESTNET_INDEX_CATCHUP_PASS
FINAL_TESTNET_TIMER_ACTIVE
FINAL_TESTNET_LIVE_READ_ONLY_PASS
FINAL_TESTNET_CREDIT_RECEIPTS_VERIFIED
FINAL_TESTNET_AUTOMATED_GATE_PASS
```

## Public-chain smoke test after the automated gate

Use only disposable BNB Testnet wallets and test assets. Do not reuse a mainnet
operator or owner private key in a browser.

1. Test user A registers on the current chain-97 vault.
2. Test user B registers with A as referrer.
3. User B deposits the minimum reviewed test amount.
4. Both wallets complete Daily Activity with the website signature flow.
5. Wait for one complete configured test period and confirm a new personal
   profit credit for B.
6. Confirm the referral credit for A from the same eligible source period.
7. B reinvests credited test profit, then confirm the next eligible period uses
   the increased principal only once.
8. B creates a test profit withdrawal request.
9. The owner approves that request through the existing approval path.
10. Confirm the queue reports paid and the wallet receives the net test-token
    amount.
11. Restart the worker/service once after confirmed credit and verify the
    journal does not replay the credit or payout.
12. Record transaction hashes for the deposit, confirmed allocation batch,
    reinvestment and paid withdrawal.

## Pass criteria

A successful automated gate alone is not a completed end-to-end test. Mainnet
preparation may continue only when all of these are true:

- automated gate reports PASS;
- live catch-up status is `indexed`;
- timer is active;
- no unresolved blocker is reported;
- personal credit is confirmed;
- referral credit is confirmed;
- reinvestment changes later eligible principal exactly once;
- approved withdrawal is paid exactly once;
- restart produces no duplicate payment;
- every claimed public-chain action has a confirmed BNB Testnet receipt.

A stale status, missing receipt, RPC ambiguity, pending signed transaction,
unexpected target, inactive timer, index backlog or duplicate credit is a FAIL.

## What this test does not prove

A successful testnet run does not prove future profitability, production
liquidity, mainnet RPC availability or mainnet funding. Mainnet still requires
the separate chain-56 final gate, verified deployment, dedicated reporter,
production manifest, archive RPC, gas and real reward funding.

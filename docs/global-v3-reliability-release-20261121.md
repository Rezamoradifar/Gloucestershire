# Global V3 reliability fixes

This release extends the verified wallet-session source at
`e1c257d1990b0142071e2935a7234ee8d8119161`. It retains the existing single-capital
BNB Testnet deployment, hourly accrual rules, fee routing, token, account records,
principal locks and withdrawal approvals. No contract redeployment or migration
is part of this change.

## Corrected behavior

- A node that verifies the deployment and then fails during account reading no
  longer ends the entire refresh. The reader retries the complete snapshot on
  another independently verified node, discards partial data, checks the wallet
  again and rechecks the confirmed block. The whole refresh has a shared
  120-second deadline; read-only wallet identity queries have an eight-second
  deadline. Signing and wallet connection prompts are not retried or timed out.
- A possibly submitted wallet transaction leaves a review reminder scoped to
  that wallet, chain and contract. When browser storage is available, the
  reminder survives reload and account switches. Only public hashes are stored;
  provider errors, calldata and signatures are not. Business/event verification
  must succeed before the operation clears its marker. Explicit review remains
  available to the user. This is a retry guard, not an atomic lock between tabs.
- New keeper accrual journals include the original signed transaction before
  broadcast. After an interrupted first broadcast, recovery can send only those
  identical bytes, after checking the deployment, sender, chain, nonce, method,
  target, gas envelope, current eligibility and absence of an observed
  transaction. Receipt reconciliation remains mandatory. Old journals without
  signed bytes remain untouched and require inspection.
- An unloaded Reinvest account no longer displays zero recorded profit. A
  verified account with actual zero profit still displays zero.

## Public-chain observation

A read-only check at **2026-11-20 22:15:24 UTC** independently verified the
release's creation transaction, source-pinned creation-code hash, token code,
child contracts, roles and confirmed block. The observation anchor was block
`143908359`, hash
`0x364170c865fe0739ebb50d8dcb55c04ef99e0b1396cab3ecfb1db6bdea9ee606`.

| Item | Observed value |
| --- | --- |
| Chain | BNB Testnet, 97 |
| Vault | `0xA1ad7226b808f56a06f1e736C3700A56fa8bFc29` |
| Members | 2 |
| Principal | 3,822 mock-token units |
| Recorded profit | 0 |
| Vault cash | 0 |
| Withdrawal requests | 0 |
| Paused | false |
| Keeper | `0x0FEE0C0Cda4fBe6282593A0D42ae9b832160231e` |
| Keeper gas balance | 0 tBNB |
| Keeper confirmed transaction count | 0 |

Both members had one investment position and three additions. One account's
24-hour check-in had expired; the other was eligible at the observed block.
These facts explain outstanding operating requirements. They do not establish
the VPS timer state, inspect a private journal, or prove that the newly fixed
code defects caused this specific live interruption.

Sources:

- [Active vault](https://testnet.bscscan.com/address/0xA1ad7226b808f56a06f1e736C3700A56fa8bFc29)
- [Creation transaction](https://testnet.bscscan.com/tx/0x847869e315f1c713e6a3765187f1f78ec082c9672613e5f687fb5226a9f95b27)
- [Keeper](https://testnet.bscscan.com/address/0x0FEE0C0Cda4fBe6282593A0D42ae9b832160231e)
- [Observed block](https://testnet.bscscan.com/block/143908359)

## Installation and operational completion

### Validation completed before publication

- Full frontend suite: **463 tests passed in 94 files**.
- Targeted keeper recovery, journal, worker, canonical receipt and local EVM
  suite: **22 tests passed**.
- TypeScript and the production Vite build passed using the published
  single-capital deployment identity. Local runtime: Node 24.22.3.
- A browser preview of the final build passed seven behavioral checks for
  unloaded Reinvest state, read-only wallet restoration, pending reminders,
  reload and account switching. The mobile viewport had no overflow or missing
  static assets. This preview used a synthetic read-only provider and blocked
  external RPC calls; it was not a signed-wallet or live-payment test.
- The public disconnected site rendered at 1440px and 390px without JavaScript
  exceptions or missing assets. Its root, hourly and single-capital routes
  served the same prior build. This does not prove installation of this fix.
- Independent code reviews of the keeper recovery and persistent review guard
  completed without remaining blocking findings.

The frontend acceptance suite includes a local EVM flow through two deposits,
single-capital accounting, keeper accrual, reinvestment, pooled withdrawal,
approval, funding and payment. The late-account-read and interrupted-broadcast
regressions were also reproduced against the previous source before validating
the fixes.

### Apply the existing deployment profile

Use a clean, pinned checkout of this release on `vps-luna-2585` and the existing
installer:

```bash
bash scripts/start-v3-unified-release.sh <verified-release-sha> --single-capital --primary
```

This path reuses the existing deployment proof and separate keeper. It publishes
the same verified build at the main dashboard, `/hourly-test/` and
`/single-capital-test/`. The installer checks host, source, dependencies,
deployment identity and worker identity, and retains its existing backups and
HTTP checks. Do not add `--deploy-testnet` for this repair.

Successful completion prints:

```text
GLOBAL_SINGLE_CAPITAL_PRIMARY_AVAILABLE=https://globaldroptrade.com/#dashboard
```

Publication alone does not make accrual or payouts operational:

1. The pinned keeper needs at least **0.001 tBNB on chain 97** and an active
   `global-v3-single-capital-keeper-testnet.timer`. Read its status and bounded
   service logs after installation. The reviewed check did not access the VPS.
2. Each member must maintain its own on-chain 24-hour check-in. The test contract
   does not backfill absent eligibility periods.
3. A withdrawal requires a request, manager approval, exact test-token funding
   or sufficient protected existing cash, and a separately confirmed payment.
   A zero cash balance cannot pay a request by itself.
4. Confirm the first keeper accrual receipt and an actual paid withdrawal
   receipt before reporting that these operations work on the public testnet.

The USDT denomination is a display label for the existing mock token. This
release does not enable mainnet or turn test balances into real Tether.

# Global mainnet final launch package — 2026-11-11

This package is the final **preparation** layer for the existing Global codebase.
It does not broadcast a deployment, fund a production contract, grant reporter
authority or enable a production writer by itself.

## Reviewed base

- Base revision: `7523f2adb22efeb33ffd94ed25e7ca87280290c5`.
- BNB Smart Chain mainnet: chain ID `56`.
- Production USDT: `0x55d398326f99059fF775485246999027B3197955`.
- BNB/USD feed: `0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE`.
- USDT/USD feed: `0xB97Ad0E74fa7d920791E90258A6E2085088b4320`.
- Production period: 86,400 seconds.
- Ordinary `AutomaticGroupVault` artifact and existing approval-queue model.
- Testnet catch-up and chain-97 journals remain separate and are never migrated.

## Final gate

Run from a pinned clean checkout as root:

```bash
bash ubuntu-mainnet-final-gate.sh \
  --from 0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632 \
  --rpc-file /etc/globaldroptrade/mainnet-rpc-url
```

The pre-deploy gate runs the offline constructor plan, the live chain-56 current
and historical RPC checks, and the fixed production address/period review. It
prints `MAINNET_DEPLOYMENT_AND_ACTIVATION_MANIFEST_REQUIRED` at the end by
design. That is not an installation failure: the contract has not yet been
deployed and therefore no valid production activation manifest can exist.

After a separately reviewed mainnet deployment, complete the private production
manifest at `/etc/globaldroptrade/mainnet-automation.json` and rerun:

```bash
bash ubuntu-mainnet-final-gate.sh \
  --from 0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632 \
  --rpc-file /etc/globaldroptrade/mainnet-rpc-url \
  --activation-file /etc/globaldroptrade/mainnet-automation.json
```

This second run invokes the existing production automation read-only check. It
still does not enable the writer timer.

## Inputs that must be supplied after deployment

Do not invent these values. Copy them from the verified mainnet creation and
the dedicated automation setup:

- deployment transaction hash;
- deployer address;
- deployed vault address;
- deployed runtime hash;
- withdrawal queue address;
- deployment block;
- production start timestamp;
- dedicated reporter/operator address;
- primary server machine ID;
- private archive-capable RPC files.

The dedicated reporter/operator must not reuse the owner key. The production
key is stored only after the public address has received the intended on-chain
reporter permission.

## Funding gate

A production timer is not enabled merely because the code passes. Before writer
activation, review:

1. operator BNB balance for gas;
2. reward ledger budget for every supported asset;
3. actual vault cash after profit, fee reserves and queued withdrawals;
4. owner liquidity authority and the existing 10%/10%/80% deposit routing;
5. an approved withdrawal path;
6. a confirmed testnet personal/referral credit and payout evidence;
7. archive RPC historical coverage and canonical checkpoint rechecks.

The worker waits rather than changing the contractual amount when reward funding
is insufficient. Testnet tokens, testnet balances and chain-97 journals are
never production funding.

## Activation

Only after the final gate is green and the deployment/manifest values have been
independently reviewed:

```bash
bash ubuntu-production-automation.sh --check \
  /etc/globaldroptrade/mainnet-automation.json
```

For a standby host, keep `role: "standby"`; it remains read-only. For a
primary host, use a separate operator key and matching `executionMachineId`.
Then installation of the systemd timer is a distinct explicit action:

```bash
bash ubuntu-production-automation.sh --install \
  /etc/globaldroptrade/mainnet-automation.json
```

The install command may start the production worker and therefore must not be
run until the contract, reporter permission, gas, reward funding and activation
manifest are all verified.

## Stop conditions

Do not proceed with real funds if any of these are present:

- wrong chain, wrong contract runtime or changed constructor recipients;
- stale or mismatched price feeds;
- RPC without required historical state/log coverage;
- owner reused as the automation signer;
- reporter permission missing;
- zero operator gas;
- reward budget or actual cash shortfall;
- pending or noncanonical saved transaction;
- unverified withdrawal queue;
- site/API still targeting chain 97;
- unresolved journal or machine-binding mismatch.

A passed preparation gate is evidence that the reviewed prerequisites were
observed. It is not a guarantee of profitability, liquidity or future RPC
availability.

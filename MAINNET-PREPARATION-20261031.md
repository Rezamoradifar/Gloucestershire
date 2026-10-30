# Mainnet preparation package — 2026-10-31

This package prepares GlobalDropTrade for a separately reviewed chain-56 launch.
It does not deploy, activate a signer, change the public site, migrate testnet
accounts, move test rewards or change existing economic rules.

## Reviewed candidate

- Base revision: 1ef7a2ed5f2d8151318e037a6d89ff338964c436.
- Ordinary AutomaticGroupVault, initial owner
  0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632.
- Production assets and constructor recipients remain in config.mainnet.json.
- Recompiled runtime: 24,181 bytes; initcode: 30,071 bytes; bytecode hash:
  0x64f24990045d9ef3d268e97657ed6e6af013cb73fc8ec39b9a862929c069e8cf.
- Existing production planning uses fixed 86,400-second periods and period-start
  active principal, including completed reinvestment. It does not automatically
  compound un-reinvested profit.

The current mainnet fixed-period schedule differs from the testnet's independent
position anniversaries. The position-anniversary worker remains chain-97-only.
The desired production activation policy must be reviewed before activation;
this release does not silently select a different first-payment schedule.

## Preparation performed

The ordinary contract was rebuilt and its pinned hash reproduced. Fourteen
existing mainnet tests and five additional historical-RPC tests passed locally.
Coverage includes the ordinary chain-56 deposit/daily/referral/reinvestment/
approved-withdrawal lifecycle and financial boundaries. The web production build
and 100 frontend tests passed. These are local fixtures, not mainnet payments.

The new read-only RPC check first runs the existing production token/feed and
unsigned gas-estimation preflight. It then locates a canonical block at least
24 hours old, reads token and feed code/state at that block, rejects feed state
substituted from the present, reads a bounded historical transfer-log window,
and rechecks both canonical headers. It records its exact scope: passing these
probes does not guarantee unlimited archive retention or prove history for a
future vault that has not been deployed.

A selected public mainnet RPC passed the current production preflight at block
130752315 but rejected historical eth_getCode with RPC code -32000 (not
supported). Consequently full live readiness remains unverified. The purchased
private RPC must pass the new check on the VPS.

## Server commands

Store the purchased chain-56 endpoint without displaying it:

    python3 scripts/save-mainnet-rpc.py

It uses the existing reviewed private-file writer, keeps previous private input
backups and writes only /etc/globaldroptrade/mainnet-rpc-url. It does not modify
/etc/globaldroptrade/archive-rpc-url or the live testnet environment.

Then run:

    bash ubuntu-mainnet-readiness.sh check \
      --from 0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632 \
      --rpc-file /etc/globaldroptrade/mainnet-rpc-url

The public address is used only for simulation, not as a selected deployment
signer. Success prints MAINNET_RPC_AND_24H_HISTORY_PREFLIGHT_PASSED and a private
report filename. A failure reports only safe phase/error codes. No key is read,
no transaction is signed or broadcast, and no service is stopped or restarted.
The existing `bash ubuntu-mainnet.sh plan` still creates an unsigned offline
constructor report. Deployment remains disabled in these entrypoints.

## Launch requirements still outstanding

Passing preparation does not set readyToDeploy to true. Before activation:
confirm all seven partner recipients and the operations recipient; review owner
liquidity authority and the 10%/10%/80% deposit routing (no principal cash retained
by a deposit); obtain complete live testnet payment/referral/reinvestment and
approved-withdrawal evidence; review the exact production timing policy; verify
private historical RPC coverage; authorize reporter governance; and fund the
new mainnet reward vault and operator using real assets. Testnet balances and
funding are never treated as mainnet money.

Existing reporter governance and owner-approved withdrawal rules are preserved.
The mainnet worker, creation identity, site/API connection and separate financial
journals still require a reviewed activation after deployment.

## Review artifacts

- [Unsigned constructor and recipients](reports/mainnet-unsigned-plan-20261031.json)
- [Local checks and live RPC observation](reports/mainnet-preparation-20261031.json)
- [Production BNB/USD feed reference](https://data.chain.link/feeds/bsc/mainnet/bnb-usd)
- [Production USDT/USD feed reference](https://data.chain.link/feeds/bsc/mainnet/usdt-usd)

The unsigned report is a review artifact, not permission to broadcast.

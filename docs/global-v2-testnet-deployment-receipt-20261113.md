# Global V2 isolated testnet deployment receipt — 13 November 2026

## Operator-provided result

The user supplied an Android Termius screenshot showing completion of the pinned release install, 16/16 local tests passing, and the following `--deploy` and `--verify` CLI outputs on `root@vps-luna-2585`. This is a **transcription of operator-provided terminal output**, not an independent explorer/API receipt verification by the author.

- Network: BNB Testnet, chain ID `97`
- New V2 address: `0xA98D8d3709f5D3730BAD5d76C334731784e7CF07`
- Deployment transaction hash: `0xbcf8142110c4a5e7d33544c4f00a730ad4335e62ec5f2d3f67f49997ba3e854b`
- Deployment block: `142416836`
- Verified runtime code hash: `0x3e1f99305bf7edbb12d4d9870124f84ece95bb23b6bf890470e94d06a336bf99`
- V2 constructor admin: `0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632`
- Isolated release SHA: `248da7c591fc26c8da367c7cace8b5d66bc27d3f`
- V2 prototype init code hash displayed by preflight: `0xc0010241923b2c8ef7cba19940c200925d436eb502b4a4c7bc27740fd7d969ca`
- Profit withdrawal fee: `feeBps = 300` (3%)
- Cooldown: `259200` seconds (72h)
- New contract member count: `0`
- New contract withdrawal count: `0`
- CLI verified the new contract address, code hash, role settings and empty state; it printed `V2_TESTNET_DEPLOYED` and `V2_TESTNET_VERIFIED`.
- Old Global testnet site vault was not replaced; preflight printed `legacyUnchanged: true`.

Explorer destinations (to be independently checked):
- https://testnet.bscscan.com/address/0xA98D8d3709f5D3730BAD5d76C334731784e7CF07
- https://testnet.bscscan.com/tx/0xbcf8142110c4a5e7d33544c4f00a730ad4335e62ec5f2d3f67f49997ba3e854b

## Next-phase restrictions

This is an **isolated testnet PROTOTYPE**, not a live or audited investment deployment. It has zero members and zero queued withdrawals. It has **not** migrated existing users or account balances. Do not update site RPC, DNS, installed worker or `TRADES_VAULT_ADDRESS` to this V2 address. Do not run a second deployment attempt; `/var/lib/globaldroptrade/v2-prototype/deployment.json` is the root-only one-shot marker and `--verify` is the designated check.

V2 still needs independent smart contract and economic review, bounded on-chain tests with consented test accounts, UI integration, a clear business revenue provenance model and enforceable liquidity/principal custody. The existing 10/10/80 deposit routing does not leave the claimed 100% principal in this vault. Do not accept real funds or claim that this new vault guarantees profit/principal withdrawals merely because its deploy transaction was confirmed.

KYC admin remains manually authorized and may activate VIP users by role-specific `setVipKyc`, while 24-hour check-in is user-initiated on chain. Every withdrawal must receive administrator approval before any executor may pay its original requesting wallet. Actual profits/referral credits require a separate cash-funded settlement action; deployment does not enable future earnings automatically.

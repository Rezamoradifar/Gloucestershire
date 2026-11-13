# Global automatic activity and manual VIP/KYC separation (testnet-only draft)

## User-requested behavior
1. Any wallet with an on-chain registration, at least $1 of recorded capital, and a canonical **wallet-signed check-in within its last 24 hours** can qualify for automatic contract activity verification.
2. An independent, opt-in testnet reporter uses the existing contract's `setCustomerStatus(wallet, true, existingKyc)` to set the wallet's `active` flag without deliberately changing `vipKyc`.
3. VIP/KYC approval must remain a **human decision** in the existing administrative review screen. No KYC document is stored by this worker. Unverified VIPs remain ineligible for VIP-only commissions.
4. A signed activity check-in is not a wallet transfer and does not guarantee profit. Profit/referral eligibility and funding checks still run separately in the reward worker. No reward batch, epoch, balance, referral amount or past period is modified by this feature.

## Critical protocol restriction
**The current deployed vault does not truly enforce KYC-only-admin separation:** its `setCustomerStatus(address,bool,bool)` is protected by a single Reporter role that controls both `active` and `vipKyc`. Even though the proposed worker preserves the last observed KYC value and never intentionally changes it, a compromised Reporter key could still modify KYC, and there is a theoretical concurrent-update race. This must be corrected in a future audited contract with independent permissions:
- `ACTIVITY_VERIFIER_ROLE`: `setVerifiedActivity(address,bool)`
- `KYC_ADMIN_ROLE`: `setVipKyc(address,bool)`
- Explicit wallet-signature evidence policy for activity, revocation, role changes, timelocks where appropriate, and append-only audit events.

Do not describe KYC as cryptographically admin-only in the current contract.

## Source-only deliverables
- `scripts/auto-activity-eligibility.mjs`: fail-closed pure decision engine.
- `scripts/auto-activity-testnet.mjs`: guarded `--check` (read-only) / `--execute` (explicit on-chain activity write) worker. Validates signed immutable check-ins, chain 97, pinned vault runtime hash, fresh canonical checkpoints, registration, capital, activation cutover and reporter role. Uses a **dedicated root-owned reporter key** and caps each execution at 10 activations with a maximum fee of 0.001 BNB per transaction. Existing KYC is re-read immediately before sending and must be preserved. This does not send payments or modify financial journals.
- `website/src/AdminWalletLookup.tsx`: show member details for BNB and USDT, direct registrations vs active directs, last signed check-in, referrer, positions and KYC independently.

## Not installed
No private key or enabled policy has been provisioned, no standalone systemd timer has been installed, and no on-chain activity transaction was broadcast from this development task. Existing payment and KYC functionality remains unchanged.

## Reviewed example policy (do not use this sample as production authorization)
```json
{
  "version": 1,
  "chainId": 97,
  "enabled": true,
  "vaultAddress": "0x4C0F6141b18971db4b14E45c0bE8cDdB09febc14",
  "runtimeHash": "REPLACE_WITH_VERIFIED_ONCHAIN_32_BYTE_RUNTIME_HASH",
  "origin": "https://globaldroptrade.com",
  "historyFile": "/var/lib/globaldroptrade-api/daily-activity.json",
  "reporterKeyFile": "/etc/globaldroptrade/auto-activity/limited-reporter.key",
  "maxActivations": 3,
  "activationTimestamp": 1794520000
}
```
Configuration is intentionally not shipped enabled. Policy file must be root-owned mode 600. The separate reporter must be granted the on-chain Reporter role by an authorized contract owner and funded for small testnet gas fees; the existing financial worker key must not be reused. Validate the actual signed daily-activity history location; do not infer it from previous V1 deployments.

## Prior to real deployment
- All CI checks, smart contract review, wallet activity signatures and runtime hash verification.
- Testnet rehearsal with two known consenting test users: registered and active check-in, registered but expired check-in, and registered no capital.
- Verify other users' KYC values and user profit/withdrawal journals unchanged, no missed or repeated credit.
- Review automated expiration/revocation semantics as a separate policy: this first version activates eligible users but does **not** automatically deactivate them when check-in expires; the independent 24-hour eligibility gate remains authoritative for rewards.
- Admin access must use an authenticated wallet, never a publicly mutable API.
- Until the contract has separated privileges, a reporter key remains capable of changing KYC even though this worker avoids doing so.

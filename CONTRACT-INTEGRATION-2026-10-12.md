# Contract and wallet integration — v0.7.1

The referral page previously displayed network information without a complete wallet flow for the revised volume rewards. The frontend also applied the external deposit minimum to reinvestment, although the contract accepts smaller positive funded profit.

## Changes

- Add network group creation, branch addition, volume preparation and reward claims to the referral page. Review dialogs identify the contract, group and stage before wallet submission. Branch reads are paginated in batches of 12 and group reads in batches of 4; each displayed snapshot uses one block.
- Add `NETWORK_PLAN_VERSION() == 2`, `prepareNetworkRewardAtStage(group, expectedStage, steps)` and `claimNetworkRewardAtStage(group, expectedStage)`. The new methods reject stale stages before changing reservations or balances. The original preparation and claim methods remain available for ABI compatibility. The updated frontend uses the guarded methods exclusively.
- Separate deposit and reinvestment validation. The deposit minimum still applies to new deposits; reinvestment requires a positive USD value and all existing contract checks.
- Report version compatibility separately from economic-plan compatibility in the read-only connection preflight.
- Synchronize the compiled ABI and deployment console, and regenerate the Ubuntu website archive with the current frontend and visual assets. Package versions and the displayed client version are 0.7.1.

The seller percentages, tier qualifications, fourteen rewards, branch caps, sequential additional-volume consumption, permanent disjoint group membership, fees, owner powers and governance rules are unchanged by this patch. Preparation and claims still require funding, liquidity and the existing contract conditions. Claims credit USDT profit; withdrawal is a separate operation.

## Validation

- Contract/API suite: 96 tests passed, 0 failed. Tests cover stale-stage rejection, preservation of reservations on failed claims, branch caps, accounting and reinvestment.
- Connection preflight: 7 tests passed after adding the version compatibility flag.
- Frontend: 12 tests passed, including actual frontend wallet methods against newly deployed contracts on a local Ganache chain. Tests verify a $1 reinvestment, unchanged deposit minimum, group creation/addition/preparation/claim, stale-stage rejection and account changes.
- TypeScript and production Vite build passed. Compiled contract runtime is 23,572 bytes, below the 24,576-byte EVM limit.
- Chromium with a local test wallet completed group creation, $500 volume preparation and an exact $35 USDT profit credit, advancing the group to stage 2. No JavaScript errors or document overflow at widths 320, 390, 768 and 1400. The closed mobile sidebar was verified after its transition completed.
- Installer tests passed for initial installation, an SSL-preserving update and rollback after a failed nginx configuration check, using mocked host services.
- Reconstructed release archive: 4,213,693 bytes, 116 files; every file matched the current build or installer. SHA-256: `b8084bf8e6c515eebc80b8d94ad59d03dccded874ad3edeee77863e0f2a34dd6`.

## Deployment status

All wallet transactions in this validation were on an isolated local chain with generated test accounts. No public-chain contract was deployed or upgraded, and no production server was changed. The regular frontend build has no public contract configured. An existing immutable deployment cannot acquire these methods through a frontend update; a compatible reviewed deployment and its verified chain/address are required for the new controls. Version checks indicate interface compatibility, not proof of bytecode authenticity.

Vercel serves the frontend and API; it does not deploy the Solidity contract. No new Vercel deployment was created during this patch.

This report supersedes older release notes that describe the bundled Ubuntu archive as unchanged. The current archive contains this frontend release.

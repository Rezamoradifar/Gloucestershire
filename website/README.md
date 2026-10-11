# GLOBAL English frontend v0.7.1

React / TypeScript / Vite / ethers. Ships the ABI compiled from the current v0.7.1 source. Development release, no public contract configured.

## Changes

- Exchange/bridge functions and website sections removed.
- Exactly seven permanent voting partners, one vote per wallet per proposal. Initial quorum is 2 of 7 with a two-day delay. Current quorum and all seven addresses appear in Contract transparency when connected. Actual partner addresses are still required before deployment.
- `setFees` now takes two parameters (profit and principal penalty); removed bridge parameter.

- Dedicated immutable profit-withdrawal fee wallet: 0x74015dedf36677485793f1714ec7bd4893907b26. The original two 10% deposit destinations are unchanged.
- Invite-count milestone bonuses remain removed. The network page now supports branch groups, bounded volume preparation and funded volume-stage reward claims. It reads the five seller tiers and fourteen reward stages from the contract.
- Network actions require `NETWORK_PLAN_VERSION() == 2` and use stage-guarded preparation/claim methods. Stale requests cannot execute against a later stage. Existing contracts need a reviewed compatible deployment; changing the frontend does not upgrade them.
- Reinvestment accepts positive funded profit below the external deposit minimum, matching the existing contract rule.
- Owner treasury withdrawal and capital-return forms. Owner can move all liquid funds without partner approval or delay; user claims remain recorded.
- Disclosure on landing, dashboard and deposit/reinvestment review. Treasury views display actual liquid cash, accounting shortfall and owner capital not yet returned. External assets and returns are not verified.
- Session compatibility check verifies all three fee destinations. This check does not prove deployed bytecode authenticity.

## Run

From the repository root:

```bash
npm ci --ignore-scripts
npm run compile
npm ci --ignore-scripts --prefix website
cp website/.env.example website/.env
npm test --prefix website
npm run build --prefix website
npm run dev --prefix website -- --host 127.0.0.1
```

Frontend integration tests use the compiled contracts and root Ganache dependencies. All test wallets and transactions are local.

Set VITE_CHAIN_ID (97 testnet, 56 mainnet) and the independently verified VITE_VAULT_ADDRESS, then rebuild. VITE variables are public; never place keys or recovery phrases in them. Serve dist over HTTP. Unconfigured transactions remain disabled.

Principal credit remains 100% of a deposit. Two 10% payments are taken from that deposit and 80% remains as operating cash. Reserve accounting does not guarantee backing, and the owner can move liquid cash. User exits depend on liquidity being available or returned. Profit figures are recorded allocations, not guaranteed withdrawable cash. Returning capital does not create profit or deposit credit.

The owner form sends funds to an explicitly entered address. returnCapital restores cash without creating new obligations. Performance budget funding and authorized sales settlement remain available. Full governance/KYC management, WalletConnect, real commerce, historical indexing remain outside this frontend.

See browser-validation.json, treasury-wallet-validation.json and test-results.txt for validation. Public-chain wallet tests and independent audit remain pending. Older presentation/PDF files describe superseded rules and must not be used as this version's user terms. Source image provenance remains in ASSETS.md.

Current integration validation and release scope: [CONTRACT-INTEGRATION-2026-10-12.md](../CONTRACT-INTEGRATION-2026-10-12.md). The bundled Ubuntu website archive has been rebuilt from this frontend; the older preview release notes describing an unchanged archive are superseded.

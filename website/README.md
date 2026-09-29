# GLOBAL English frontend v0.5.0

React / TypeScript / Vite / ethers. Requires DropshippingVault v0.3.0 ABI. Development release, no public contract configured.

## Changes

- Exchange/bridge functions and website sections removed.
- Exactly seven permanent voting partners, one vote per wallet per proposal. Initial quorum is 2 of 7 with a two-day delay. Current quorum and all seven addresses appear in Contract transparency when connected. Actual partner addresses are still required before deployment.
- `setFees` now takes two parameters (profit and principal penalty); removed bridge parameter.

- Dedicated immutable profit-withdrawal fee wallet: 0x74015dedf36677485793f1714ec7bd4893907b26. The original two 10% deposit destinations are unchanged.
- Invite-count milestone bonuses and claim UI are removed. Four-level sales referrals and tier qualifications remain.
- Owner treasury withdrawal and capital-return forms. Owner can move all liquid funds without partner approval or delay; user claims remain recorded.
- Disclosure on landing, dashboard and deposit/reinvestment review. Treasury views display actual liquid cash, accounting shortfall and owner capital not yet returned. External assets and returns are not verified.
- Session compatibility check verifies all three fee destinations. This check does not prove deployed bytecode authenticity.

## Run

```bash
npm ci --ignore-scripts
cp .env.example .env
npm run dev -- --host 127.0.0.1
npm test
npm run build
```

Set VITE_CHAIN_ID (97 testnet, 56 mainnet) and the independently verified VITE_VAULT_ADDRESS, then rebuild. VITE variables are public; never place keys or recovery phrases in them. Serve dist over HTTP. Unconfigured transactions remain disabled.

Principal credit remains 100% of a deposit. Two 10% payments consume previously funded reserve credit. Because the owner can spend its cash, reserve accounting does not guarantee backing; actual payments can use pooled cash including incoming deposits. User exits depend on liquidity being available or returned. Profit figures are recorded allocations, not guaranteed withdrawable cash. Returning capital does not create profit or deposit credit.

The owner form sends funds to an explicitly entered address. returnCapital restores cash without creating new obligations. Performance budget funding and authorized sales settlement remain available. Full governance/KYC management, WalletConnect, real commerce, historical indexing remain outside this frontend.

See browser-validation.json, treasury-wallet-validation.json and test-results.txt for validation. Public-chain wallet tests and independent audit remain pending. Older presentation/PDF files describe superseded rules and must not be used as this version's user terms. Source image provenance remains in ASSETS.md.

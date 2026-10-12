# Wallet connections

The dashboard offers a browser-wallet option and a WalletConnect option for QR/mobile connections. Both use the same selected EIP-1193 provider for account reads, balances, network changes and transaction signing. A connection requests account access only. Existing contract checks and transaction review remain in place. Disconnect and account/network events clear account data and any pending review; a disconnected mobile wallet never silently falls back to an installed extension.

## Required public setting

The user's Project ID `41040f658e4d4120399041c145b5e8b0` is now configured in the tracked, public `website/.env.production`, together with chain 97 and the verified testnet vault. A normal production build, including `ubuntu-domain.sh`, reads this file. Existing process environment variables and mode-specific local overrides can take precedence. This does not change any contract wallet.

Create or open the Global Drop Trade project at https://dashboard.reown.com and copy its **Project ID**. Add these domains under the project's Configuration / Domain settings:

- `globaldroptrade.com`
- `www.globaldroptrade.com`

If testing another origin, add that exact preview host too. The connection metadata uses the actual browser origin. An allowlist entry and a correct metadata URL do not override the wallet's independent verification or risk checks.

Set the public Vite variable before building:

```dotenv
VITE_WALLETCONNECT_PROJECT_ID=your_project_id
VITE_CHAIN_ID=97
VITE_VAULT_ADDRESS=0x7f19354B765920B9b17003d0840EEaA133883DcA
```

On the server, place the values in `website/.env.local` in this release checkout, or export them in the shell that runs `bash ubuntu-domain.sh`. Keep the existing file's other settings. Vite reads these at build time, so rebuild/reinstall after changing them. The domain installer already exports the testnet chain and verified vault address; it preserves an exported WalletConnect Project ID.

On Vercel, add `VITE_WALLETCONNECT_PROJECT_ID` as a **Config** environment variable for the desired Production/Preview environments and rebuild. This is a public project identifier, not a wallet key or an API secret. No private key, recovery phrase or owner signature is required for this integration. No Vercel environment was changed by this PR.

If the ID is missing or malformed, the QR/mobile option is visibly unavailable, while browser-wallet connection still works. The WalletConnect SDK and QR interface load only after the user chooses that option. The integration pins `@walletconnect/ethereum-provider` 2.26.0; its bundled AppKit handles the mobile/QR modal.

## Validation and remaining activation

- 21 frontend tests passed, including selected-provider routing, rejected connections, stale provider events, explicit disconnect, late connection cancellation, testnet switching, and refusal to sign on the wrong chain.
- Existing local-contract integration tests passed: small reinvestment, reward-group preparation/claim and account-change rejection. No economic contract source was changed.
- TypeScript and the Vite production build passed with the verified testnet vault configured.
- **The user's Project ID is configured for the production build.** No paired QR/mobile session or owner-wallet connection has been confirmed. Complete an end-to-end mobile connection and cancellation check after installing, with the site's domains allowlisted in Reown.
- Publishing through the connected Vercel account was blocked by HTTP 403 for scope `rusekingdom-4810`; no Vercel environment or deployment was changed. No CLI credentials or server SSH access were available. The server installation remains a separate execution step.

Official references: https://docs.reown.com/advanced/providers/ethereum and https://docs.reown.com/appkit/domain-verification

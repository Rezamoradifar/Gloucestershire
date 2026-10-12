# Account dashboard update — 2026-10-12

The dashboard now follows the site's charcoal and gold visual style. Account data remains blank until the selected wallet and configured network are loaded.

- The account header separates wallet connection, required network and loaded block status.
- The withdrawal breakdown shows recorded profit, the contract cap, cooldown, shared treasury liquidity, fee and estimated net amount at the loaded block. It is not a reservation or payment guarantee. Transaction-time checks and simulation remain in place.
- Lifetime external deposits, completed reinvestments and their combined withdrawal-cap basis are displayed separately. Reinvestment is read at the same block as the rest of the snapshot.
- Position counts and next unlock are explicitly limited to the loaded list, with its total count visible.
- The deposit form shows actual cash routing to operations and the two fee wallets alongside the full principal credit.
- The WalletConnect picker explains same-phone and second-device steps; the dashboard shows connection progress and readable cancellation/expiry messages.

## Verification

The production site was opened on 2026-10-12. Its wallet selector and WalletConnect QR modal rendered. Closing the QR modal returned control to the dashboard; leaving an unapproved proposal to expire produced an expiry error. No mobile wallet session, signature or transaction was completed in that browser. This observation does not establish the cause of the user's mobile connection failure.

Local validation: production TypeScript/Vite build and 24 frontend tests passed, including the real local-contract integration and withdrawal estimate boundary tests. No economics, contract addresses, wallet destinations or on-chain state were changed.

Deploying this frontend requires rebuilding from this revision and installing it. A private static preview does not prove the user's Nginx server has been updated or that its live transaction API is connected.

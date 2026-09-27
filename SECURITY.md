# Security boundary — v0.4.0

This is a non-upgradeable, owner-controlled treasury, not an independently audited or capital-protected system. No public deployment is included.

## Changed rules
- Deposits immediately route floor(amount / 10) to each immutable fee wallet and the remainder to an immutable operations wallet. No fee-reserve credit is consumed or required. All routing is inside the deposit reentrancy guard; failure rolls back the complete transaction.
- Principal claims and external-deposit history still credit the gross deposit. All incoming deposit cash leaves the vault. There is no cash-backing invariant. Ledger totals and exact shortfall/surplus reporting are the applicable accounting properties.
- Principal penalties remain in the vault. Gross liquidity is required before principal withdrawal; only net principal leaves. The cumulative retained-penalty counter is not a segregated cash balance or user claim. Owner powers remain unrestricted, and free surplus can still use the partner route.
- Fourth-level commissions require the recipient's current VIP tier, active status and KYC approval. The former active-direct requirement is replaced, not added. Skipped shares remain with the seller. Historic VIP status is not sufficient.

## Trust and availability
The operations wallet is required at deployment and cannot later be replaced. It must accept BNB and supported tokens. An inaccessible or rejecting wallet can block deposits. Price feeds, supported-token behavior, reporter data and wallet availability remain trust boundaries. Fee-on-transfer inbound tokens are rejected; outbound rebasing or fee token behavior is outside the supported-token assumptions.

The owner can remove all liquid assets immediately, including user-associated cash, rewards and retained principal penalties. Seven partner votes govern only their separate surplus route. Returning capital does not credit profit; settlement funding is a separate action. Commercial returns, customer orders and API integrations are not executed by the vault. The owner-capital-outstanding counter includes automatic operations transfers and manual owner withdrawals, not external proof of assets.

Profit-withdrawal fees still go to the dedicated third wallet. Existing positions retain their lock/penalty snapshots. New deployment changes the constructor ABI; the old frontend must be updated and verified before connection. No private keys or actual operations address are included in this package.

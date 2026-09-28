# Security boundary — v0.5.0

This is a non-upgradeable, owner-controlled treasury, not an independently audited or capital-protected system. No public deployment is included.

## Changed rules
- Deposits immediately route floor(amount / 10) to each immutable fee wallet and the remainder to an immutable operations wallet. No fee-reserve credit is consumed or required. All routing is inside the deposit reentrancy guard; failure rolls back the complete transaction.
- Principal claims and external-deposit history still credit the gross deposit. All incoming deposit cash leaves the vault. There is no cash-backing invariant. Ledger totals and exact shortfall/surplus reporting are the applicable accounting properties.
- Principal penalties remain in the vault. Gross liquidity is required before principal withdrawal; only net principal leaves. The cumulative retained-penalty counter is not a segregated cash balance or user claim. Owner treasury powers remain unrestricted. All partner surplus-withdrawal entry points are removed.
- Fourth-level commissions require the recipient's current VIP tier, active status and KYC approval. The former active-direct requirement is replaced, not added. Skipped shares remain with the seller. Historic VIP status is not sufficient.

## Trust and availability
The operations wallet is required at deployment and cannot later be replaced. It must accept BNB and supported tokens. An inaccessible or rejecting wallet can block deposits. Price feeds, supported-token behavior, reporter data and wallet availability remain trust boundaries. Fee-on-transfer inbound tokens are rejected; outbound rebasing or fee token behavior is outside the supported-token assumptions.

The owner can remove all liquid assets immediately, including user-associated cash, rewards and retained principal penalties. Seven partners only vote on owner-proposed configuration calldata hashes. Execution needs the captured quorum (initially two) and a two-day delay. Votes are tied to monotonically increasing proposal rounds; cancel/requeue and successful execution invalidate previous approvals. Owner pause, ownership transfer and direct treasury withdrawal remain outside configuration governance. Returning capital does not credit profit; settlement funding is a separate action. Commercial returns, customer orders and API integrations are not executed by the vault. The owner-capital-outstanding counter includes automatic operations transfers and manual owner withdrawals, not external proof of assets.

Profit-withdrawal fees still go to the dedicated third wallet. Existing positions retain their lock/penalty snapshots. New deployment changes the constructor ABI; the old frontend must be updated and verified before connection. Public owner, operations and partner addresses are configured; private keys are not included.

## Migration
The existing public testnet deployment is v0.4.0 and cannot be upgraded. Recompile and deploy v0.5.0 to adopt voting-only partners. Never discard an existing signed deployment journal to work around a bytecode mismatch; use a separate release checkout and deployment state. Old local reports and verification results do not apply to the new bytecode.

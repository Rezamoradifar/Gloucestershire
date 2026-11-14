# Global V3 functional testnet status

This release targets BNB Testnet (chain 97) and the contract's pinned mock
USDT-like token. Contract transactions are real testnet transactions; the
token has no monetary value. The site must not describe test-token claims as
real Tether, business revenue, wallet cash, or guaranteed repayment.

## Connected account functions

The V3 account workspace verifies its configured contract runtime, deployment
receipt, manager, asset and original 10% / 10% / 80% destinations before it
reads balances or sends wallet actions. Registration, test-token approval and
deposit, activity check-in, eligible accrual, manual reinvestment, referral and
network actions, withdrawal requests, manager approval, separate funding and
payment use the current contract. Every transaction still requires its
appropriate signer and confirmation.

History reads bounded blocks from the verified contract and the connected
wallet, anchored at a confirmed block and no earlier than deployment. A claim
event and a paid-withdrawal event are labeled separately. Explorer links are
available for transactions and the complete event log. An RPC error or block
reorganization blocks that page rather than inventing entries.

The daily cycle is an estimate based on the last verified block. A funded and
operating testnet keeper is required for unattended posting, together with the
contract's eligibility conditions. Its operation on any server is not proven
by a frontend build. Withdrawals require actual mock-token cash, approval,
funding and a confirmed payout; changing the interface cannot create funds.

## Remaining integrations

- The retailer search depends on configured external Amazon/eBay API
  credentials. Retailers, not this site, handle purchases; the contract is not
  connected to orders or sales revenues.
- AI sourcing and order execution are not connected to the V3 workspace.
- V3-specific private support tickets and announcements are not installed by
  the site-only release; the V2 support service is not V3 account data.
- A V3 testnet deposit-to-accrual-to-approved-funded-payout cycle has to be
  observed on the deployed public chain and reconciled before it can be called
  verified for that deployment. A local EVM test is not that evidence.
- The mobile visual comparison is blocked in the current authoring
  environment; the published site still needs an actual device check.

This site release does not deploy a contract, import previous accounts, fund a
withdrawal, activate a keeper, or authorize BNB Mainnet and real assets.

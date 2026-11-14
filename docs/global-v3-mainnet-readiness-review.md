# Global V3 mainnet readiness review

The reviewed V3 is a chain-97 testnet contract. Its constructor rejects chain
56. Its deployment and website scripts also pin the mock test asset. The
separate `AutomaticGroupVault` mainnet preparation scripts are for an older
contract family, not a production release of V3. No V3 mainnet contract,
deployment, public-chain acceptance or production readiness is established by
this review.

## Verified in the source and local tests

- In a local EVM, the current V3 constructor rejects chain 56 and accepts the
  same valid constructor parameters on chain 97.
- The original deposit destinations and percentages are unchanged. In a local
  100-unit mock deposit, the vault retains zero units while recording 100 units
  of principal liability. A separately funded approved withdrawal is required
  to turn a claim into a token payment.
- The V3 liquidity checker now reads the runtime, cash, liabilities, escrow,
  and sampled requests at one confirmed block and rejects a changed block hash.
  Its hash is supplied by the operator; a single-RPC result does not establish
  an independent canonical, economic, or security audit.
- All four V3 administration, management, funding, and guardian roles are
  granted to the same manager at construction. A production role and key
  management design requires review before deploying real assets.

## Evidence and work still required

1. Confirm the actual routed V3 deployment identity, installed site revision,
   and keeper timer and run result on the intended server. A started service is
   not evidence that installation or a keeper transaction succeeded.
2. On the public testnet, verify a real mock-token deposit, eligible check-in,
   daily and compounded accrual, an approved and funded withdrawal, and the
   confirmed beneficiary token receipt. Reconcile liabilities and liquidity at
   the same confirmed block. A local simulation is not that public-chain test.
3. Connect an authorized seller and supplier, implement and verify the actual
   buy/sell flow, and reconcile sales, product costs, shipping, fees and
   refunds before reporting commercial profit. A product catalog or an order
   count does not establish execution, profit, or the use of deposited funds.
4. Agree on and independently review a sustainable liquidity source and
   disclosed treatment of principal, claims, fees, and withdrawal limitations.
   The fixed routing does not retain deposit cash in the V3 vault.
5. Obtain an independent contract and operational security review, resolve
   findings, and review role custody, incident response and applicable
   financial and consumer requirements for the actual operating jurisdiction.
6. Only after the preceding design and evidence are complete, prepare a
   separate V3-specific production contract, asset and deployment plan. Test
   the exact reviewed build and obtain explicit review of the actual chain-56
   address, code, recipients, roles and production parameters.

Do not use the testnet deployment or the legacy mainnet plan as a V3 mainnet
deployment command. No code in this review sends a transaction, transfers a
token, enables a keeper, deletes data, or changes the contract's economics.

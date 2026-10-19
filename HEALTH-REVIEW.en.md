# Contract 0.6.0 health review

Historical review date: September 29, 2026, Tehran time. Contract source baseline: commit `68a0bd7c3c8b9a03e0927f609fc1ad96065bfe34`.

## Result and scope

The recorded run passed 70 tests with zero failures or skipped tests in approximately 104 seconds. It ran on Linux, Node 24.19.0 and local Ganache, not the user's VPS. After the final `tmp` patch, clean installation, compilation and deployment-artifact comparison passed again with unchanged bytecode hash. Scope included local EVM execution, source review, independent-model arithmetic comparison, clean Linux installation, dependency review and deployment-artifact consistency. This was not an independent audit, complete mathematical proof, absence-of-vulnerabilities guarantee or profitability guarantee. No mainnet or public-testnet transactions were sent during this review. Frontend behavior and actual retailer/dropshipping integration were excluded.

## Test coverage

- Exact 10/10/80 BNB and USDT splits, rounding and atomic rollback on transfer failure.
- Fixed destinations, seven voting-only partners, quorum, two-day delay, duplicate-vote and duplicate-execution rejection.
- Profit withdrawals with the initial 5% fee, per-asset caps, cooldowns, principal locks and retained penalties.
- Profit/principal accounting across settlements, funding, reinvestment and withdrawals; settlement-ID replay prevention.
- Reentrancy attempts through BNB receipt and operations-wallet transfers; owner/reporter access controls.
- Stale, zero, negative, future-dated and invalid-round oracle data; 6/18-decimal conversion and a $0.80 USDT scenario.
- All fourteen reward stages, exact consumed volume, carry-over, final-stage termination, changing branch-size ordering, independent groups and branch-sharing prevention.
- Atomic stage and consumed-volume rollback on insufficient funding, liquidity, valid prices or a paused contract; rejection of another user's reward claim.
- An independent 72-operation model covering BNB, USDT and sales, all branch volumes, the largest three branches and qualifying directs with at least $100 current principal.
- Correct direct-branch attribution, out-of-order queue completion, no double counting and a 74-level network.
- Local deployment, safe interrupted-run recovery, no duplicate deployment, mainnet rejection by testnet tooling and secret-free public reports.
- ABI/bytecode parity between the deployment console and fresh compilation, plus verification-input/source consistency.

## Changes made during the review

1. Compilation now precedes all tests. Previously, some deployment tests could use older artifacts.
2. `ethers` was upgraded to 6.17.0 and `ws` to 8.21.0. Compiler dependency `tmp` was pinned to 0.2.7; the Solidity compiler version was unchanged.
3. Ganache, solc and OpenZeppelin sources moved into development dependencies. `--omit=dev` installs only execution dependencies.
4. Removed 317 extraneous lockfile entries inherited from Ganache bundles, which caused clean Linux installation to fail on macOS-only `fsevents`. Full and execution-only installs were checked separately.
5. Fixed comparison of ethers return structures in a new test; the mismatch came from a library wrapper rather than a contract-state change.

Contract source and economic logic were unchanged during this review. Creation-bytecode SHA-256:

`2eec8e62873be75036ea50d12c97ed27ca1d8a94d8c35b0ad9e9fc58d8921b49`

## Size and gas

Runtime bytecode measured 21,693 bytes, below the 24,576-byte limit. Local measurements were approximately 5.69 million gas for deployment, 1.03 million for a deposit processing eight ancestors and 5.10 million for processing 64 ancestors. These are not dollar costs or guaranteed mainnet fees. Run details are in `health-test-results.txt`.

## Remaining limitations and risks at that release

- The owner can withdraw all cash, including liquidity corresponding to user claims, without partner votes. Testing this behavior does not verify financial backing.
- Every initial deposit leaves the vault: 80% operations and 20% fixed shares. Full principal remains recorded. Without returned funds, withdrawals lack cash. Even penalized principal withdrawals require gross liquidity so the penalty actually stays in the vault.
- Network rewards require separate funding. All fourteen stages consume $19,999,500 volume and credit $621,975 per group. Volume is an activity metric, not cash; deposits, sales and reinvestments can recirculate the same capital.
- Authorized reporters attest sales profit and volume. The contract does not independently verify sales documents, run an automatic profit-generating bot or prove off-chain income. Team volume can count for several ancestors, increasing aggregate reward obligations.
- Ownership transfer does not automatically remove the previous owner's reporter role or grant it to the new owner. Reporter management is a separate governed configuration path.
- Daily targets are not automatic or guaranteed profit. Profit caps are per asset. A BNB-only account needs USDT withdrawal capacity for USDT rewards, for example by reinvesting credited USDT under the applicable rules.
- The historical three-branch group is permanent and ends after stage fourteen. Operators or public callers must complete deep-network queues; ancestor volume is incomplete until then.
- The execution-only clean install excludes Ganache and solc and reported zero known runtime dependency advisories. Local Ganache still had vulnerable dependencies and must not be exposed publicly or use real keys/funds. Removing extraneous lock entries did not patch those bundled packages. The recorded full lockfile scan had seven advisories: one critical, five high and one moderate, associated with Ganache and dependencies. Initial bundled-package listings had more warnings. Before/after reports were retained.
- npm auditing covers dependency databases, not Solidity bytecode security. Independent security review, real-oracle testing and a new-version public-testnet deployment rehearsal had not been completed by this review.

## Repeat validation

From the repository with a supported Node version:

```bash
npm ci --include=dev --ignore-scripts
npm test
```

For execution using reviewed compiled artifacts in a separate environment:

```bash
npm ci --omit=dev --ignore-scripts
npm audit --omit=dev
```

The second install cannot compile or run the full tests. Neither command sequence deploys a contract. Reinstall with `--include=dev` before rerunning tests. Fetching updated source does not change immutable deployed contracts.

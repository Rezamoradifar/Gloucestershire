# Dependency security review — 13 October 2026

The frontend uses ethers 6.17.0, ws 8.21.0, Vite 6.4.4 and Vitest 5.0.4. The complete frontend npm audit reports zero known advisories. Frontend tooling requires Node 22.12+, 24, or 26+; the bundled server runtime is Node 22.23.3.

The local EVM retains the `ganache` import through an npm alias to the official unbundled `@ganache/core` 0.10.2 package. This allows npm overrides to update its dependencies rather than retaining vulnerable copies inside the bundled Ganache distribution. ws, lodash, secp256k1 and elliptic/bn.js are pinned to the reviewed versions in package.json.

Root production dependencies report zero advisories. The full root development tree has no moderate, high or critical advisories. It still reports 35 low-severity package findings propagated from the single unpatched elliptic advisory GHSA-848j-6mx2-7j84. Elliptic 6.6.1 is the latest published release at review time and remains affected. These findings are not suppressed. The local EVM uses disposable test keys; real signing keys must never be used in that environment.

This dependency update does not modify Solidity source, economics, or deployment configuration. Existing public contracts are unchanged. npm audit is a dependency check, not a smart-contract security audit. The live server must install this release before these updates affect it; the previously observed API 502 requires separate server repair.

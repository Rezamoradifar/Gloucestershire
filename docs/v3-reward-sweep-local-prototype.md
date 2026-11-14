# BLOCKED: local-only reward sweep experiment

**Do not deploy, install, connect this prototype to public testnet or use it
with real funds.** The associated automatic registration-order grouping
contract has a demonstrated zero-deposit group-poisoning vulnerability: an
attacker can occupy all slots in another account's permanent group. Passing
these tests does not fix, mitigate or approve that contract.

This local-only module explores bounded round-robin member/group scans for
eligible, auto-enabled beneficiaries and full three-branch groups. It calls
`claimNetworkRewardsFor` as a static preflight and treats only a deterministic
EVM revert as a nonclaimable stage; transport errors stop the sweep. An
explicit injected journal must record intent before any send and only commit
the cursor after the exact contract event, beneficiary and group are verified.
An uncertain send/receipt must remain pending for review.

The code has no CLI, key loading, deployment proof validation, signer setup,
systemd unit, public provider, durable journal implementation or production
install path. It is not an authorization to connect a real signer. In-process
Ganache tests are only local simulations and provide no public-testnet result,
backing, demonstrated business earnings, paid withdrawal or audit.

After a separately reviewed grouping/consent design addresses the demonstrated
poisoning vulnerability, any production-quality worker would still need pinned
chain/deployment/runtime and mock asset validation, dedicated nonprivileged
gas wallet, nonce/race limits, confirmed canonical receipts and reorg handling,
atomic durable intent/cursor recovery, gas caps, monitoring, and comprehensive
end-to-end tests against a separately deployed test contract.

# BLOCKED: local identity-attestation experiment

**Do not deploy or connect this experiment to public testnet or mainnet.**
There is no identity provider, verifier service, real KYC, approved privacy
design, frontend, migration or secure release flow in this experiment.

The prototype builds on the equally blocked auto-group prototype. An immutable
verifier, distinct from the initial admin, signs an EIP-191 digest binding the
wallet, exact referrer, expiry, per-wallet nonce, chain ID and contract address.
Only the subject wallet can submit its approval. Both direct registration and
deposit auto-registration must consume a matching, unexpired approval inside
the same transaction that assigns the group. Replay, forgery, changed domain,
changed referrer and a wrong caller are intended to fail closed. No personal
identity record or identity hash is placed on chain; public wallet, referrer,
signature and expiry remain publicly observable.

**Critical limitation:** a signature proves only that the verifier approved the
relationship. Identity verification by itself does not establish consent from
the named referrer or prevent three different verified individuals from filling
an unwanted permanent group. The EVM test explicitly demonstrates that an
attestor which approves an unwanted relationship still permits the grouping.
There is no implementation or verified policy for referrer authorization,
person-level uniqueness, multiple wallets, attestation revocation or continuing
identity eligibility after registration. An approval expires before registration
only; a registered account remains registered after its approval expires.

No provider, signer or real-world verification was chosen. A compromised or
incorrect verifier can approve malicious links. The prototype verifies a
separate initial verifier address but does not prevent a privileged admin from
later granting it unrelated roles. Role separation, key rotation, expiry policy,
availability, privacy, access control and signer compromise recovery need an
independent design and review. Signature validation is an experiment, not an
audited substitute for maintained cryptographic libraries.

Automatic stage claim timing can also affect future reward eligibility even if
each claim is atomic: for a 500 target and 300 per-branch cap, claiming with
A=200/B=300 consumes A200+B300; waiting until A=300 consumes A300+B200. If final
volumes are A900/B400/C200, the next 1000 stage sees 900 versus 1000 eligible.
The timing and allocation rule must be explicitly specified and reviewed.

Compiled runtime is 24,562 bytes, only 14 bytes under EIP-170's 24,576-byte
limit for this exact compiler/input. Any additional feature may exceed it; a
modular redesign and fresh measurement are required. Local tests do not prove
public-chain behavior, security, funding, payment or mainnet readiness.

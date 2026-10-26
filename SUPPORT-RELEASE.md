# Existing fast-testnet support release

Support sign-in now uses the selected wallet's account, network and message
signature without reading contract bytecode, fee destinations or oracle state.
The complete server challenge must match the website origin, configured network,
contract, wallet and nonce before a wallet prompt opens. Identity is checked again
after signing. Switching accounts or views invalidates outstanding UI work.

Expired sessions are cleared with a sign-in instruction. A compound create/reply
and refresh operation is never automatically replayed after an HTTP 401; this
prevents a completed write from being duplicated. Duplicate clicks are blocked.
Administrator mode changes clear cached sessions and the inbox. Administrator
access is still enforced by the API against the current on-chain owner.

The release includes a rebuilt, checksum-verified public frontend. On the existing
Ubuntu VPS, run the pinned release's `bash ubuntu-support.sh` as root. It requires
128 MiB free space and 2,000 free inodes on the website filesystem. It accepts
only the connected chain-97 fast vault
`0x04E26FcaA198d21cEf6d04e1e54f9C5f6399e522` and a working support API.
It takes the existing connection lock, preserves the current deployment/status
consoles, updates the managed website, verifies served HTML and API identity,
and restores its previous Nginx configuration on failure. Private backups are
stored under `/var/backups/globaldroptrade/support-*`.

The command does not install dependencies, rebuild on the VPS, change the API
release, restart financial workers, open keys or send blockchain transactions.
It preserves the existing support database. Do not use the old
`ubuntu-community.sh`, which targets an earlier contract. Reload open site tabs
following a successful `GLOBAL_SUPPORT_FRONTEND_READY` result.

Validation includes wallet-only authentication, challenge binding, abandoned
sessions, HTTP session expiry without replay, private ticket isolation, owner
responses, close/reopen, nonce replay, expired challenges, persistence after an
actual HTTP API restart, and mocked installation success/rollback/network refusal.
Local tests are not evidence that this release has been installed on the VPS.

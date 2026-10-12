# Global Drop Trade: domain and source verification

## Verified on 12 October 2026

All four existing BNB Testnet contracts have **exact creation and runtime matches** in Sourcify. The submitted compiler input was already public in this repository, at revision `12de0606aaf2d3a047db53ebfe50aefe66a9efa1`. The compiler is Solidity `0.8.30+commit.73712a01`, optimizer 200 runs, viaIR, Paris EVM. Records, submission IDs and verification times are in `deployments/global-source-verification-20261012.json`.

| Contract | Verified source |
| --- | --- |
| DropshippingVault | [0x7f19354B765920B9b17003d0840EEaA133883DcA](https://repo.sourcify.dev/97/0x7f19354B765920B9b17003d0840EEaA133883DcA) |
| MockToken | [0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89](https://repo.sourcify.dev/97/0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89) |
| BNB MockFeed | [0xDA264c16Ec8832748a1A5A31b963deD9E48e337a](https://repo.sourcify.dev/97/0xDA264c16Ec8832748a1A5A31b963deD9E48e337a) |
| USD MockFeed | [0xE7D68dF5e1e9B0F5BeB3201b4Ab1d64aC7761454](https://repo.sourcify.dev/97/0xE7D68dF5e1e9B0F5BeB3201b4Ab1d64aC7761454) |

Sourcify returned an external Etherscan submission ID for each contract. BscScan completion is **unconfirmed**: the status API requires an API key, and public explorer pages returned HTTP 403 from this workspace. Source verification proves source/bytecode correspondence; it is not a security audit. No new deployment or blockchain transaction was performed.

## Install the domain on the existing server

The checked A records for both `globaldroptrade.com` and `www.globaldroptrade.com` already point to `104.167.16.102`. The authoritative nameservers are `atlas.dns-parking.com` and `hyperion.dns-parking.com`. No DNS change is needed for this server.

From a separate checkout of this release on that Ubuntu/Debian server, run as root:

```bash
apt-get update
apt-get install -y git nginx curl ca-certificates xz-utils python3 certbot python3-certbot-nginx
bash ubuntu-domain.sh
```

The script checks DNS before changing Nginx, backs up `/etc/nginx` under `/var/backups/globaldroptrade/`, builds the current frontend with chain ID 97 and the verified vault address, installs the IP virtual host on port 8961, and installs the domain virtual host. It then requests a Let's Encrypt certificate for both names, redirects HTTP to HTTPS, enables `certbot.timer`, and checks the certificate and exact HTML on both HTTPS names locally. It preserves the existing IP virtual host and does not read or change the deployer key, owner, partners, or financial parameters.

If UFW is already active, ports 80, 443 and 8961 are allowed. A provider firewall must also permit the intended ports. The default Certbot registration uses no email; set `CERTBOT_EMAIL` in the server environment to receive account notices. Failed issuance or HTTPS checks stop before `HTTPS_READY` is printed. The printed Nginx backup is retained for manual recovery; Certbot failures are not claimed to be automatically rolled back.

Success ends with:

```text
HTTPS_READY https://globaldroptrade.com
WWW_READY https://www.globaldroptrade.com
IP_SITE_PRESERVED http://104.167.16.102:8961
```

Then check the domain from outside the server. For manual rollback, inspect the printed backup, restore only this installation's affected configuration files from it, run `nginx -t`, and reload Nginx only if validation succeeds. Do not restore the whole Nginx directory over unrelated later changes.

## Execution status and API

Shell syntax and the mocked installer checks passed: DNS gate, chain/address settings, separate domain/IP hosts, backup, certificate flags, timer, and failure gates for certificate, HTTPS and incorrect HTML. **The installer has not been executed on the target server from this workspace; SSH access was unavailable.** The preflight still served the Nginx welcome page over HTTP, while HTTPS and port 8961 returned HTTP 502 through the request path. This does not establish which server or upstream rule is blocking them.

The frontend is configured for the existing **testnet** vault. `/api/` preserves the read-only proxy to localhost:3115; this command does not activate or verify a live settlement API. The public RPC's `eth_getLogs` limitation remains recorded in `TEMPORARY-IP-SITE.md`. An existing working API is retained. To activate a new API, use `ubuntu-connect.sh` with a server RPC that passes its preflight. No transaction history is fabricated.

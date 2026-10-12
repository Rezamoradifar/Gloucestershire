# Temporary GLOBAL website on 104.167.16.102

Run `bash ubuntu-ip-website.sh 104.167.16.102` as root from this release checkout on Ubuntu/Debian. Required packages: nginx, curl, ca-certificates, xz-utils, python3. The script downloads checksum-checked Node.js 22.23.3 into the checkout, installs frontend dependencies, and builds the current source before touching Nginx. It does not use the older prebuilt website-release archive.

The installer creates an explicit `server_name 104.167.16.102` virtual host, retaining the existing default website and domain/SSL configurations. Assets, FAQ, company-document sample images, dashboard and the `/deploy/` console come from this release. Releases live in `/var/www/globaldroptrade/releases/`; the temporary virtual host is `/etc/nginx/sites-available/globaldroptrade-ip-104.167.16.102`. Failed Nginx validation, reload, or the local HTTP content check restores the previous configuration.

This temporary URL is HTTP. HTTPS is not provisioned by this command. The installer sends no blockchain transactions and never reads any deployer key or deployment journal. The contract and live settlement feed still need a verified deployment and explicit connection settings. `/api/` keeps the existing read-only proxy to port 3115; it does not invent trading activity if that backend is unavailable.

Validation: TypeScript/Vite production build; shell syntax; initial install, domain SSL preservation, IP host collision, repeated update, invalid IP rejection and configuration/HTTP-check rollback with mocked system services. The actual target returned the Nginx welcome page before preparation. Remote installation requires running the command on that server; no SSH credentials were available to this workspace.

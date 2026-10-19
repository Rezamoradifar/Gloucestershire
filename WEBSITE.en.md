# Install GlobalDropTrade on Ubuntu

**Installation route documented on October 12, 2026:** for the domain on `104.167.16.102`, use `ubuntu-domain.sh` and `DOMAIN-SETUP.md`. That installer builds the source with the verified testnet contract, preserves port 8961, and enables and verifies domain HTTPS. The packaged release and version notes below describe older releases. At the time of these notes, this environment had not executed the installer on the VPS.

React source is in `website/`. The prebuilt package in `website-release-parts/` contains Base64 parts generated from that source and can be installed without Node on the server. It includes public website files and the installer, not private keys or contract artifacts.

```bash
cd /root/global-bnb &&
git pull --ff-only &&
sudo bash ubuntu-website.sh
```

Nginx must be installed, `globaldroptrade.com` and `www.globaldroptrade.com` must resolve to the server, and ports 80/443 must be open. The installer preserves other domains and existing SSL when updating its recognized configuration. It stops on an unfamiliar configuration. Port 8000 is not exposed publicly.

After successful installation:

```bash
sudo certbot --nginx -d globaldroptrade.com -d www.globaldroptrade.com --redirect
```

Certificate issuance requests an email address and acceptance of the issuer's terms. Working DNS and public port 80 access are required.

## Historical version status

The original packaged frontend was version 0.5.0; contract 0.6.0 three-line rewards were not yet implemented in that interface. It was a preview with no configured contract address and disabled transactions. Installing that website did not deploy a contract or activate investments.

## Rebuild the package after source changes

With a supported Node version, run `npm ci` and `npm run build` inside `website`, then `python3 scripts/package-website.py` from the repository root. This packages `dist` with the installer and regenerates the parts and SHA-256 checksum. Editing source alone does not change the published package.

The installer reconstructs the parts and checks SHA-256. Required build images are committed under `website/public/assets/`.

## Landing update — October 1, 2026

English commerce and AI copy, company history and a six-step example were added. Scale and historical claims were identified as team-supplied and unverified. At that release, AI and the contract were not connected to live services.

Initial installation and upgrades both used `sudo bash ubuntu-website.sh`. The installer updates only the recognized domain's root, preserves SSL, refuses unknown configurations and restores the previous configuration if Nginx validation fails.

After subsequent frontend builds, regenerate and commit the package parts and checksum with the source. WebP images are committed directly; the old prebuild step was removed.

Validation recorded for that release: TypeScript/Vite build passed, five money tests passed, desktop and 390px browser reviews passed, including menus, example tabs, policy dialogs, images and dashboard link. Mock-service installer checks covered initial installation, SSL preservation and rollback. These results did not establish installation on the VPS.

#!/usr/bin/env bash
# Upgrade ONLY the Global static frontend to a verified NEW V3 BNB TESTNET
# release, preserving V2 contract / address / API / customer history.
# This is NOT a contract deployer, wallet signer or database migration.
set +x
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "$0")/.."
[[ $# -eq 1 && ( "$1" == --check || "$1" == --install ) ]] ||
 { echo "USAGE: bash scripts/install-v3-site-when-verified.sh --check|--install"; exit 1; }
[[ "$(id -u)" -eq 0 ]] || { echo V3_SITE_ROOT_REQUIRED; exit 1; }
[[ -d .git && -f ubuntu-global-v2-site.sh && -f scripts/verify-v3-site-deployment.mjs ]] ||
 { echo V3_SITE_REVIEWED_REPOSITORY_CHECKOUT_REQUIRED; exit 1; }
sha="$(git rev-parse HEAD)"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo V3_SITE_SHA_INVALID; exit 1; }
export GLOBAL_V2_EXPECTED_SHA="$sha"
arch="$(uname -m)"
if [[ "$arch" == x86_64 ]]; then arch=x64; elif [[ "$arch" == aarch64 ]]; then arch=arm64; else echo V3_ARCH_UNSUPPORTED; exit 1; fi
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
[[ -x "$runtime/node" ]] && export PATH="$runtime:$PATH"
command -v node >/dev/null || { echo V3_NODE_RUNTIME_MISSING; exit 1; }
# Always do a root-only read, on verified BNB Testnet, of the actual V3
# operator deployment proof. No config => stop BEFORE changing the website.
node scripts/verify-v3-site-deployment.mjs --check
# The executable only emits constant-name, hex-validated, public env vars.
# Never read private keys, or install before the actual deployment is pinned.
site_vars="$(node scripts/verify-v3-site-deployment.mjs --emit-site-env)"
[[ "$site_vars" == *"export VITE_V3_PRIMARY_DASHBOARD=verified-testnet"* ]] ||
 { echo V3_SITE_RELEASE_VARIABLES_INVALID; exit 1; }
eval "$site_vars"
echo "V3_SITE_READONLY_RELEASE_VERIFIED=$sha"
if [[ "$1" == --check ]]; then
 bash ubuntu-global-v2-site.sh --check
 echo V3_WEBSITE_COMPILE_AND_ACCEPTANCE_PASS
 echo V3_PRIMARY_DASHBOARD_INSTALLED=NO
 exit 0
fi
# Existing installer has its own full build/test, SHA check, current-site
# backup, atomic web release switch and rollback on failure.
bash ubuntu-global-v2-site.sh --install
echo "V3_TESTNET_PRIMARY_DASHBOARD_INSTALLED"
echo "V3_PUBLIC_TESTNET_CONTRACT_VERIFIED"
echo "V3_V2_LEGACY_CONTRACT_AND_DATA_PRESERVED"
echo "V3_FINANCIAL_MAINNET_NOT_APPROVED"

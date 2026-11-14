#!/usr/bin/env bash
# Read-only account diagnosis followed by the verified TESTNET frontend update.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 ]] || { echo ROOT_REQUIRED; exit 1; }
[[ $(hostname -s) == vps-luna-2585 ]] || { echo WRONG_SERVER_USE_VPS_LUNA_2585; exit 1; }
[[ $# == 3 && $1 =~ ^0x[0-9a-fA-F]{40}$ && $2 =~ ^0x[0-9a-fA-F]{40}$ && $3 =~ ^[0-9]+([.][0-9]+)?$ ]] || {
 echo V3_DEPOSIT_CASE_ARGUMENTS_INVALID
 exit 1
}
proof=/var/lib/globaldroptrade/v3-hourly-testnet/deployment.json
[[ -f $proof && ! -L $proof && $(stat -c %u "$proof") == 0 ]] || {
 echo GLOBAL_HOURLY_TESTNET_PROOF_MISSING
 exit 1
}
release=$(cd -- "$(dirname -- "$0")/.." && pwd -P)
if ! python3 "$release/scripts/diagnose-v3-hourly-deposit.py" \
 --wallet "$1" --referrer "$2" --amount-test "$3"; then
 echo V3_DEPOSIT_DIAGNOSTIC_UNAVAILABLE
fi
exec /bin/bash "$release/scripts/update-v3-hourly-wallet-site.sh" --install

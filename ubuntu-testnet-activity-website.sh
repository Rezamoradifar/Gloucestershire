#!/usr/bin/env bash
# Website only; do not run the reward worker or modify contract state.
set -Eeuo pipefail
set +x
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
export GLOBAL_ACTIVITY_TESTNET_RELEASE=1
exec bash ubuntu-refine-website.sh

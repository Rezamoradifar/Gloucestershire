#!/usr/bin/env bash
# Apply the verified, isolated testnet contract, worker and wallet dashboard.
# Run from a fresh, SHA-pinned checkout under /opt/global-v3-unified-run.XXXXXXXX/release.
set +x
set -Eeuo pipefail
umask 077

deployment_cli=scripts/deploy-v3-unified-isolated.mjs
deployment_rpc=https://bsc-testnet-dataseed.bnbchain.org
verification_rpc=https://bsc-testnet-rpc.publicnode.com
deployment_proof=/var/lib/globaldroptrade/v3-unified-testnet/deployment-proof.json

fail() { echo "$1" >&2; exit 1; }

check_capacity() {
  local mount_path=$1 min_inodes=$2 min_kib=$3 inodes kib
  inodes=$(df -Pi -- "$mount_path" | awk 'NR==2 {print $4}')
  kib=$(df -Pk -- "$mount_path" | awk 'NR==2 {print $4}')
  [[ $inodes =~ ^[0-9]+$ && $kib =~ ^[0-9]+$ ]] || fail UNIFIED_FILESYSTEM_USAGE_UNAVAILABLE
  if (( inodes < min_inodes || kib < min_kib )); then
    printf 'UNIFIED_INSUFFICIENT_CAPACITY path=%s free_inodes=%s required_inodes=%s free_KiB=%s required_KiB=%s\n' \
      "$mount_path" "$inodes" "$min_inodes" "$kib" "$min_kib" >&2
    exit 1
  fi
}

check_site_target() {
  local work=$1 site_root target
  local -a https=(curl -fsS --max-time 15 --noproxy '*' --resolve globaldroptrade.com:443:127.0.0.1)
  nginx -t
  nginx -T > "$work/nginx.conf" 2>/dev/null
  "${https[@]}" https://globaldroptrade.com/ -o "$work/root.html"
  "${https[@]}" https://globaldroptrade.com/hourly-test/ -o "$work/hourly.html"
  site_root=$(python3 scripts/verify-nginx-served-root.py --nginx-config "$work/nginx.conf" --served "$work/root.html")
  [[ -d $site_root/hourly-test/assets && ! -L $site_root/hourly-test && ! -L $site_root/hourly-test/assets &&
     -f $site_root/hourly-test/index.html && ! -L $site_root/hourly-test/index.html ]] || fail UNIFIED_LEGACY_ROUTE_INVALID
  cmp -s -- "$site_root/hourly-test/index.html" "$work/hourly.html" || fail UNIFIED_LEGACY_ROUTE_MISMATCH
  target="$site_root/unified-test"
  if [[ -e $target || -L $target ]]; then
    python3 scripts/publish-v3-unified-route.py owned "$site_root/.unified-test-stage.check" "$target" website/static/unified-test-status.html none
  fi
  check_capacity "$site_root" 1500 65536
}

# Only read verification is retried, to allow an independent node to reach the receipt block.
verify_proof() {
  local result delay
  for delay in 0 4 8 12; do
    if (( delay )); then sleep "$delay"; fi
    if result=$(node "$deployment_cli" --verify-existing "$verification_rpc"); then
      [[ $result =~ ^UNIFIED_DEPLOYMENT_PROOF_SHA256=([a-f0-9]{64})$ ]] || fail UNIFIED_INVALID_PROOF_REPORT
      printf '%s\n' "${BASH_REMATCH[1]}"
      return 0
    fi
  done
  fail UNIFIED_INDEPENDENT_VERIFICATION_FAILED
}

apply_release() {
  local sha=$1 proof=$2 digest on_disk worker_status=0
  local journal="${2%/*}/pending.json"
  local -a publish=(bash scripts/install-v3-unified-test-site.sh --install-prepared "$sha" "$proof")
  if [[ -e $proof || -L $proof ]]; then
    echo UNIFIED_RECHECKING_EXISTING_DEPLOYMENT
  elif [[ -e $journal || -L $journal ]]; then
    echo UNIFIED_RECOVERING_PREVIOUS_DEPLOYMENT
    node "$deployment_cli" --recover-existing "$verification_rpc" || return $?
  else
    # Check the separate RPC before any signature. The signer rechecks all limits on its own RPC.
    node "$deployment_cli" --check "$verification_rpc" || return $?
    node "$deployment_cli" --deploy-testnet "$deployment_rpc" || return $?
  fi
  digest=$(verify_proof) || return $?
  on_disk=$(sha256sum -- "$proof") || return $?
  [[ ${on_disk%% *} == "$digest" ]] || fail UNIFIED_PROOF_CHANGED
  publish+=("$digest" "$verification_rpc")
  bash scripts/install-v3-unified-worker.sh "$sha" || worker_status=$?
  case $worker_status in
    0) publish+=(--enable-testnet-wallets) ;;
    42) echo UNIFIED_WORKER_NEEDS_TEST_GAS >&2 ;;
    *) echo UNIFIED_WORKER_INSTALLATION_FAILED >&2; return "$worker_status" ;;
  esac
  "${publish[@]}" || return $?
  if (( worker_status == 42 )); then
    echo 'UNIFIED_TESTNET_READ_ONLY_AVAILABLE=https://globaldroptrade.com/unified-test/'
    return 42
  fi
  echo 'UNIFIED_TESTNET_WALLET_DASHBOARD_AVAILABLE=https://globaldroptrade.com/unified-test/'
}

main() {
  local sha=${1:-} checkout work arch runtime lock_dir
  [[ $(id -u) == 0 && $(hostname -s) == vps-luna-2585 ]] || fail UNIFIED_APPLY_WRONG_SERVER
  [[ $# == 1 && $sha =~ ^[a-f0-9]{40}$ ]] || fail UNIFIED_APPLY_EXPECTED_PINNED_SHA
  checkout=$(pwd -P)
  work=${checkout%/release}
  [[ $checkout =~ ^/opt/global-v3-unified-run\.[a-zA-Z0-9]{8}/release$ && $work != "$checkout" &&
     $(stat -c %u:%a -- "$work") == 0:700 && ! -L $work && ! -L $checkout && -d .git && ! -L .git ]] ||
     fail UNIFIED_APPLY_EXPECTED_FRESH_CHECKOUT
  [[ $(git rev-parse --show-toplevel) == "$checkout" && $(git rev-parse HEAD) == "$sha" ]] ||
     fail UNIFIED_APPLY_SOURCE_MISMATCH
  git diff --quiet HEAD -- || fail UNIFIED_APPLY_SOURCE_MODIFIED
  git ls-files --others --directory -z > "$work/untracked"
  [[ ! -s $work/untracked ]] || fail UNIFIED_APPLY_CHECKOUT_HAS_EXTRA_FILES

  case $(uname -m) in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) fail UNIFIED_UNSUPPORTED_ARCHITECTURE ;; esac
  runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
  export PATH="$runtime:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  [[ -x $runtime/node && -x $runtime/npm ]] || fail UNIFIED_NODE_RUNTIME_MISSING
  for tool in nginx curl npm git python3 flock sha256sum systemctl; do
    command -v "$tool" >/dev/null || fail "UNIFIED_REQUIRED_COMMAND_MISSING_$tool"
  done
  lock_dir=/run/globaldroptrade-unified-apply
  mkdir -m 700 -- "$lock_dir" 2>/dev/null || true
  [[ -d $lock_dir && ! -L $lock_dir && $(stat -c %u:%a "$lock_dir") == 0:700 && ! -L $lock_dir/apply.lock ]] ||
    fail UNIFIED_APPLY_LOCK_DIRECTORY_INVALID
  exec 8>"$lock_dir/apply.lock"
  flock -n 8 || fail UNIFIED_APPLY_ALREADY_RUNNING

  # Two locked dependency trees use about 77,000 inodes. Include the fresh package
  # cache, build output and a small operational reserve on the same filesystem.
  check_capacity "$work" 95000 2097152
  check_capacity /var/lib 2000 65536
  check_site_target "$work"
  export npm_config_cache="$work/npm-cache"
  npm ci --ignore-scripts --no-audit --no-fund
  npm ci --prefix website --ignore-scripts --no-audit --no-fund
  python3 scripts/verify-v3-prepared-checkout.py
  check_capacity "$work" 6000 262144
  apply_release "$sha" "$deployment_proof"
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then main "$@"; fi

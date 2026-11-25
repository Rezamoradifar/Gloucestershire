#!/usr/bin/env bash
# Apply the verified, isolated testnet contract, worker and wallet dashboard.
# Run from a fresh, SHA-pinned checkout under /opt/global-v3-unified-run.XXXXXXXX/release.
set +x
set -Eeuo pipefail
umask 077
export TZ=UTC

deployment_cli=scripts/deploy-v3-unified-isolated.mjs
deployment_rpc=https://bsc-testnet-dataseed.bnbchain.org
verification_rpc=https://bsc-testnet-rpc.publicnode.com
deployment_proof=/var/lib/globaldroptrade/v3-unified-testnet/deployment-proof.json
route_name=unified-test
profile=()
build_inodes=95000

fail() { echo "$1" >&2; exit 1; }

free_inodes() { df -Pi -- "$1" | awk 'NR==2 {print $4}'; }

check_capacity() {
  local mount_path=$1 min_inodes=$2 min_kib=$3 inodes kib
  inodes=$(free_inodes "$mount_path")
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
  target="$site_root/$route_name"
  if [[ -e $target || -L $target ]]; then
    python3 scripts/publish-v3-unified-route.py owned "$site_root/.$route_name-stage.check" "$target" website/static/unified-test-status.html none "${profile[@]}"
  fi
  check_capacity "$site_root" 1500 65536
}

# Only read verification is retried, to allow an independent node to reach the receipt block.
verify_proof() {
  local result delay
  for delay in 0 4 8 12; do
    if (( delay )); then sleep "$delay"; fi
    if result=$(node "$deployment_cli" --verify-existing "$verification_rpc" "${profile[@]}"); then
      [[ $result =~ ^UNIFIED_DEPLOYMENT_PROOF_SHA256=([a-f0-9]{64})$ ]] || fail UNIFIED_INVALID_PROOF_REPORT
      printf '%s\n' "${BASH_REMATCH[1]}"
      return 0
    fi
  done
  fail UNIFIED_INDEPENDENT_VERIFICATION_FAILED
}

install_panel_commerce() {
  local source
  GLOBAL_COMMERCE_EXPECTED_SHA="$1" bash scripts/install-commerce-api-only.sh --install || return $?
  for source in kraken amazon ebay; do
    curl -fsS --noproxy '*' --max-time 45 --resolve globaldroptrade.com:443:127.0.0.1 \
      "https://globaldroptrade.com/api/commerce/activity?source=$source" | python3 -c '
import json, sys
try:
    feed = json.load(sys.stdin)
except ValueError:
    sys.exit("GLOBAL_PANEL_COMMERCE_ROUTE_INVALID")
valid = (isinstance(feed, dict) and feed.get("source") == sys.argv[1] and isinstance(feed.get("rows"), list)
         and feed.get("status") in {"connected", "partial", "not_configured", "unavailable", "rate_limited"})
sys.exit(0 if valid else "GLOBAL_PANEL_COMMERCE_ROUTE_INVALID")
' "$source" || return $?
  done
}

apply_release() {
  local sha=$1 proof=$2 digest on_disk worker_status=0 commerce_status=0
  local journal="${2%/*}/pending.json"
  local -a publish=(bash scripts/install-v3-unified-test-site.sh "${profile[@]}" --install-prepared "$sha" "$proof")
  if [[ -e $proof || -L $proof ]]; then
    echo UNIFIED_RECHECKING_EXISTING_DEPLOYMENT
  elif [[ $route_name != unified-test && ${3:-} != --deploy-testnet ]]; then
    fail SINGLE_CAPITAL_VERIFIED_DEPLOYMENT_REQUIRED
  elif [[ -e $journal || -L $journal ]]; then
    echo UNIFIED_RECOVERING_PREVIOUS_DEPLOYMENT
    node "$deployment_cli" --recover-existing "$verification_rpc" "${profile[@]}" || return $?
  else
    # Check the separate RPC before any signature. The signer rechecks all limits on its own RPC.
    node "$deployment_cli" --check "$verification_rpc" "${profile[@]}" || return $?
    node "$deployment_cli" --deploy-testnet "$deployment_rpc" "${profile[@]}" || return $?
  fi
  digest=$(verify_proof) || return $?
  on_disk=$(sha256sum -- "$proof") || return $?
  [[ ${on_disk%% *} == "$digest" ]] || fail UNIFIED_PROOF_CHANGED
  # The proof above used an independent reader. Prefer the worker's BNB Chain
  # endpoint for the fresh pre- and post-build reads of that verified proof.
  publish+=("$digest" "$deployment_rpc")
  bash scripts/install-v3-unified-worker.sh "$sha" "${profile[@]}" || worker_status=$?
  case $worker_status in
    0) publish+=(--enable-testnet-wallets) ;;
    42) echo UNIFIED_WORKER_NEEDS_TEST_GAS >&2 ;;
    *) echo UNIFIED_WORKER_INSTALLATION_FAILED >&2; return "$worker_status" ;;
  esac
  if [[ ${3:-} == --primary || ${3:-} == --primary-with-commerce ]]; then
    (( worker_status == 0 )) || return "$worker_status"
    node scripts/publish-v3-single-capital-primary.mjs --install "$sha" "$digest" "$deployment_rpc" "${profile[@]}" || return $?
    echo 'GLOBAL_SINGLE_CAPITAL_PRIMARY_AVAILABLE=https://globaldroptrade.com/#dashboard'
    if [[ ${3:-} == --primary-with-commerce ]]; then
      install_panel_commerce "$sha" || commerce_status=$?
      if (( commerce_status != 0 )); then
        echo GLOBAL_PANEL_SITE_READY_COMMERCE_PENDING >&2
        return "$commerce_status"
      fi
      echo GLOBAL_GLASS_PANEL_INSTALLED
    fi
    return 0
  fi
  "${publish[@]}" || return $?
  if (( worker_status == 42 )); then
    echo "UNIFIED_TESTNET_READ_ONLY_AVAILABLE=https://globaldroptrade.com/$route_name/"
    return 42
  fi
  echo "UNIFIED_TESTNET_WALLET_DASHBOARD_AVAILABLE=https://globaldroptrade.com/$route_name/"
}

install_and_apply() {
  local work=$1 sha=$2 route_name=$3 proof=$4 option=$5
  local -a profile=()
  case $route_name in
    single-capital-test) profile=(--single-capital) ;;
    daily-capital-test) profile=(--daily-capital) ;;
    referral-profit-test) profile=(--referral-profit) ;;
    manual-reinvest-test) profile=(--manual-reinvest) ;;
    portfolio-test) profile=(--portfolio) ;;
    plan-portfolio-test) profile=(--plan-portfolio) ;;
    account-reinvest-test) profile=(--account-reinvest) ;;
    upline-rates-test) profile=(--upline-rates) ;;
  esac
  # Both locked dependency trees, the fresh npm cache and build output use this filesystem.
  check_capacity "$work" "$build_inodes" 2097152
  check_capacity /var/lib 2000 65536
  check_site_target "$work"
  export npm_config_cache="$work/npm-cache"
  npm ci --ignore-scripts --no-audit --no-fund
  npm ci --prefix website --ignore-scripts --no-audit --no-fund
  python3 scripts/verify-v3-prepared-checkout.py
  check_capacity "$work" 6000 262144
  apply_release "$sha" "$proof" "$option"
}

install_with_available_storage() (
  local work=$1 inodes stage image='' tool
  inodes=$(free_inodes "$work")
  [[ $inodes =~ ^[0-9]+$ ]] || fail UNIFIED_FILESYSTEM_USAGE_UNAVAILABLE
  if (( inodes >= build_inodes )); then
    install_and_apply "$@"
    return
  fi

  # Reserve 3 GiB for a private filesystem and leave space for the persistent worker and site.
  check_capacity "$work" 10000 4194304
  for tool in fallocate mkfs.ext4 unshare mount; do
    command -v "$tool" >/dev/null || fail "UNIFIED_REQUIRED_COMMAND_MISSING_$tool"
  done
  stage=$(mktemp -d -- "${work%/*}/global-v3-unified-run.XXXXXXXX")
  trap '[[ -z $image ]] || rm -f -- "$image"; rmdir -- "$stage"' EXIT
  image=$(mktemp -- "$work/build.XXXXXXXX")
  fallocate -l 3G -- "$image"
  mkfs.ext4 -q -F -m 0 -N 131072 -E nodiscard "$image"
  check_capacity "$work" 10000 1048576
  echo UNIFIED_USING_PRIVATE_INODE_WORKSPACE

  # The parent holds the deployment lock. Only the child sees the mount; nginx
  # and systemd still use their persistent paths on the host filesystem.
  shift
  unshare --mount --propagation private --fork --kill-child -- bash -ceu '
    image=$1; stage=$2; source_checkout=$3; shift 3
    mount -t ext4 -o loop,nodev,nosuid "$image" "$stage"
    chmod 0700 -- "$stage"
    cp -a -- "$source_checkout" "$stage/release"
    cd -P -- "$stage/release"
    source scripts/apply-v3-unified-testnet.sh
    install_and_apply "$stage" "$@"
  ' bash "$image" "$stage" "$work/release" "$@"
)

main() {
  local sha=${1:-} checkout work arch runtime lock_dir
  [[ $(id -u) == 0 && $(hostname -s) == vps-luna-2585 ]] || fail UNIFIED_APPLY_WRONG_SERVER
  [[ $sha =~ ^[a-f0-9]{40}$ ]] || fail UNIFIED_APPLY_EXPECTED_PINNED_SHA
  case "$#:${2:-}:${3:-}" in
    1::) ;;
    2:--single-capital:|3:--single-capital:--deploy-testnet|3:--single-capital:--primary)
      route_name=single-capital-test
      deployment_proof=/var/lib/globaldroptrade/v3-single-capital-testnet/deployment-proof.json
      if [[ ${3:-} != --deploy-testnet ]]; then
        [[ -s $deployment_proof && ! -L $deployment_proof ]] || fail SINGLE_CAPITAL_VERIFIED_DEPLOYMENT_REQUIRED
      fi
      ;;
    2:--daily-capital:|3:--daily-capital:--deploy-testnet|2:--referral-profit:|3:--referral-profit:--deploy-testnet|3:--referral-profit:--primary|2:--manual-reinvest:|3:--manual-reinvest:--deploy-testnet|3:--manual-reinvest:--primary|2:--upline-rates:|3:--upline-rates:--deploy-testnet|3:--upline-rates:--primary|2:--account-reinvest:|3:--account-reinvest:--deploy-testnet|3:--account-reinvest:--primary|3:--account-reinvest:--primary-with-commerce|2:--portfolio:|3:--portfolio:--deploy-testnet|3:--portfolio:--primary|3:--portfolio:--primary-with-commerce|2:--plan-portfolio:|3:--plan-portfolio:--deploy-testnet)
      route_name=${2#--}-test
      deployment_proof=/var/lib/globaldroptrade/v3-${2#--}-testnet/deployment-proof.json
      if [[ ${3:-} != --deploy-testnet ]]; then
        [[ -s $deployment_proof && ! -L $deployment_proof ]] || {
          [[ $route_name != daily-capital-test ]] || fail DAILY_CAPITAL_VERIFIED_DEPLOYMENT_REQUIRED
          [[ $route_name != plan-portfolio-test ]] || fail PLAN_PORTFOLIO_VERIFIED_DEPLOYMENT_REQUIRED
          [[ $route_name != portfolio-test ]] || fail PORTFOLIO_VERIFIED_DEPLOYMENT_REQUIRED
          [[ $route_name != account-reinvest-test ]] || fail ACCOUNT_REINVEST_VERIFIED_DEPLOYMENT_REQUIRED
          [[ $route_name != upline-rates-test ]] || fail UPLINE_RATES_VERIFIED_DEPLOYMENT_REQUIRED
          [[ $route_name != manual-reinvest-test ]] || fail MANUAL_REINVEST_VERIFIED_DEPLOYMENT_REQUIRED
          fail REFERRAL_PROFIT_VERIFIED_DEPLOYMENT_REQUIRED
        }
      fi
      ;;
    *) fail UNIFIED_APPLY_EXPECTED_PINNED_SHA ;;
  esac
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

  install_with_available_storage "$work" "$sha" "$route_name" "$deployment_proof" "${3:-}"
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then main "$@"; fi

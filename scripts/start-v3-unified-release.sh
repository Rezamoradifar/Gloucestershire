#!/usr/bin/env bash
# Download one pinned release into a fresh checkout on the testnet host.
set -Eeuo pipefail
umask 077

install_from_github() (
  local parent=$1 sha=$2 stage checkout fetched
  shift 2
  stage=$(mktemp -d -- "$parent/global-v3-unified-run.XXXXXXXX")
  trap 'rm -rf --one-file-system -- "$stage"' EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM

  checkout="$stage/release"
  export GIT_TERMINAL_PROMPT=0
  git -c core.hooksPath=/dev/null init --quiet -- "$checkout"
  git -C "$checkout" -c core.hooksPath=/dev/null fetch --quiet --no-tags --depth=1 \
    https://github.com/Rezamoradifar/Gloucestershire.git "$sha"
  fetched=$(git -C "$checkout" rev-parse --verify 'FETCH_HEAD^{commit}')
  if [[ $fetched != "$sha" ]]; then
    echo UNIFIED_START_FETCHED_SHA_MISMATCH >&2
    exit 1
  fi
  git -C "$checkout" -c core.hooksPath=/dev/null checkout --quiet --detach "$sha"
  cd -- "$checkout"
  bash scripts/apply-v3-unified-testnet.sh "$sha" "$@"
)

main() {
  if [[ ! ${1:-} =~ ^[0-9a-f]{40}$ ]]; then
    echo UNIFIED_START_EXPECTED_PINNED_SHA >&2
    return 1
  fi
  case "$#:${2:-}:${3:-}" in
    3:--account-reinvest:--primary-with-commerce) ;;
    1::|2:--single-capital:|3:--single-capital:--deploy-testnet|3:--single-capital:--primary|2:--daily-capital:|3:--daily-capital:--deploy-testnet|2:--referral-profit:|3:--referral-profit:--deploy-testnet|3:--referral-profit:--primary|2:--manual-reinvest:|3:--manual-reinvest:--deploy-testnet|3:--manual-reinvest:--primary|2:--upline-rates:|3:--upline-rates:--deploy-testnet|3:--upline-rates:--primary|2:--account-reinvest:|3:--account-reinvest:--deploy-testnet|3:--account-reinvest:--primary) ;;
    *) echo UNIFIED_START_INVALID_PROFILE >&2; return 1 ;;
  esac
  if [[ $(id -u) != 0 || $(hostname -s) != vps-luna-2585 ]]; then
    echo UNIFIED_START_WRONG_SERVER >&2
    return 1
  fi
  install_from_github /opt "$@"
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then main "$@"; fi

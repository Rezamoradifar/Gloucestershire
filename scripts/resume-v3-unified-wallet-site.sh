#!/usr/bin/env bash
# Resume the existing unified testnet dashboard after an interrupted release.
set -Eeuo pipefail
umask 077

release_sha=605cac9898c1e661d7ba9ce481f258ba0e289136
repository=https://github.com/Rezamoradifar/Gloucestershire.git
proof=/var/lib/globaldroptrade/v3-unified-testnet/deployment-proof.json
keeper_key=/etc/globaldroptrade/v3-unified-keeper-testnet-gas-only.key
state=/run/globaldroptrade-unified-wallet-resume
unit_pattern='^global-v3-unified-wallet-[0-9]+-[0-9]+$'

require_existing() {
  local failed=0
  if [[ ! -f $proof || ! -s $proof || -L $proof ]]; then
    echo UNIFIED_RESUME_EXISTING_PROOF_MISSING >&2
    failed=1
  fi
  if [[ ! -f $keeper_key || ! -s $keeper_key || -L $keeper_key ]]; then
    echo UNIFIED_RESUME_EXISTING_KEEPER_KEY_MISSING >&2
    failed=1
  fi
  return "$failed"
}

install_existing() (
  set -e
  require_existing
  local stage checkout
  stage=$(mktemp -d -- /opt/global-v3-unified-run.XXXXXXXX)
  trap 'rm -rf --one-file-system -- "$stage"' EXIT
  checkout="$stage/release"
  export GIT_TERMINAL_PROMPT=0
  echo "UNIFIED_RESUME_FETCHING=$release_sha"
  git -c core.hooksPath=/dev/null init --quiet -- "$checkout"
  git -C "$checkout" -c core.hooksPath=/dev/null fetch --quiet --no-tags --depth=1 "$repository" "$release_sha"
  if [[ $(git -C "$checkout" rev-parse --verify 'FETCH_HEAD^{commit}') != "$release_sha" ]]; then
    echo UNIFIED_RESUME_FETCHED_SHA_MISMATCH >&2
    return 1
  fi
  git -C "$checkout" -c core.hooksPath=/dev/null checkout --quiet --detach "$release_sha"
  cd -- "$checkout"
  echo "UNIFIED_RESUME_INSTALLING=$release_sha"
  bash scripts/apply-v3-unified-testnet.sh "$release_sha"
)

run_service() {
  local unit=$1 result
  set +e
  install_existing
  result=$?
  set -e
  printf '%s\n' "$result" > "$state/$unit.result.tmp"
  mv -T -- "$state/$unit.result.tmp" "$state/$unit.result"
  echo "UNIFIED_RESUME_EXIT=$result"
  return "$result"
}

report() {
  local unit=$1 fallback=${2:-0} result active
  printf 'UNIFIED_RESUME_UNIT=%s.service\n' "$unit"
  journalctl --no-pager -o cat -u "$unit.service" -n 12 \
    --grep='^UNIFIED_(RESUME_|WORKER_NEEDS_TEST_GAS|KEEPER_NEEDS_TEST_GAS|INSUFFICIENT_CAPACITY|VERIFICATION_RPC_|TESTNET_.*AVAILABLE)' || true
  if [[ -s $state/$unit.result ]]; then
    read -r result < "$state/$unit.result"
    [[ $result =~ ^[0-9]{1,3}$ && $result -le 255 ]] || return 1
  else
    active=$(systemctl show --property=ActiveState --value "$unit.service") || active=unknown
    printf 'UNIFIED_RESUME_SERVICE_STATE=%s\n' "${active:-unknown}"
    result=$fallback
    case "$active" in
      active|activating|reloading|deactivating) ;;
      *)
        echo UNIFIED_RESUME_NO_COMPLETION_RESULT >&2
        if (( ! result )); then result=1; fi ;;
    esac
  fi
  if (( result )); then journalctl --no-pager -o cat -u "$unit.service" -n 15 || true; fi
  return "$result"
}

resume_main() {
  local unit previous active result=0
  if [[ $(id -u) != 0 || $(hostname -s) != vps-luna-2585 ]]; then
    echo UNIFIED_RESUME_REQUIRES_ROOT_ON_VPS_LUNA_2585 >&2
    return 1
  fi
  if [[ ! -e $state && ! -L $state ]]; then mkdir -m 700 -- "$state" || [[ -d $state ]]; fi
  [[ -d $state && ! -L $state && $(stat -c '%u:%a' -- "$state") == 0:700 ]] || return 1
  case "${1:-}" in
    --status)
      [[ $# == 1 && -f $state/latest && ! -L $state/latest ]] || { echo UNIFIED_RESUME_NO_RECORDED_INSTALL; return 1; }
      read -r unit < "$state/latest"
      [[ $unit =~ $unit_pattern ]] || return 1
      report "$unit"
      return ;;
    --service)
      [[ $# == 2 && $2 =~ $unit_pattern ]] || return 1
      run_service "$2"
      return ;;
    '') [[ $# == 0 ]] || return 1 ;;
    *) echo 'Usage: resume-v3-unified-wallet-site.sh [--status]' >&2; return 2 ;;
  esac
  require_existing
  exec 8>"$state/start.lock"
  flock -n 8 || { echo UNIFIED_RESUME_ALREADY_STARTING_OR_RUNNING; return 1; }
  if [[ -f $state/latest ]]; then
    read -r previous < "$state/latest"
    [[ $previous =~ $unit_pattern ]] || return 1
    active=$(systemctl show --property=ActiveState --value "$previous.service") || active=unknown
    case "$active" in
      active|activating|reloading|deactivating) echo UNIFIED_RESUME_ALREADY_RUNNING; report "$previous"; return ;;
    esac
  fi
  unit="global-v3-unified-wallet-$(date +%s)-$$"
  install -m 0700 -- "${BASH_SOURCE[0]}" "$state/resume.sh.tmp"
  mv -T -- "$state/resume.sh.tmp" "$state/resume.sh"
  printf '%s\n' "$unit" > "$state/latest.tmp"
  mv -T -- "$state/latest.tmp" "$state/latest"
  printf 'UNIFIED_RESUME_STATUS_COMMAND=bash %s/resume.sh --status\n' "$state"
  # Pin both existing files in the service namespace for the duration of this run.
  systemd-run --quiet --unit="$unit" --service-type=exec --collect --wait \
    --property=StandardOutput=journal --property=StandardError=journal \
    --property="BindReadOnlyPaths=$proof $keeper_key" \
    /bin/bash "$state/resume.sh" --service "$unit" || result=$?
  report "$unit" "$result"
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then resume_main "$@"; fi

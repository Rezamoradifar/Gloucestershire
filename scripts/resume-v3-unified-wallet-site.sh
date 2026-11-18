#!/usr/bin/env bash
# Resume the existing unified testnet dashboard after an interrupted release.
set -Eeuo pipefail
umask 077

release_sha=24d1d9340eb4a793120f2d73722272eb9b327e5e
repository=https://github.com/Rezamoradifar/Gloucestershire.git
proof=/var/lib/globaldroptrade/v3-unified-testnet/deployment-proof.json
keeper_key=/etc/globaldroptrade/v3-unified-keeper-testnet-gas-only.key
state=/run/globaldroptrade-unified-wallet-resume
public_state=/var/lib/globaldroptrade
unit_pattern='^global-v3-unified-wallet-[0-9]+-[0-9]+$'

redact_diagnostics() {
  python3 -c '
import re, sys
text = sys.stdin.read(131072)
text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", text)
text = re.sub(r"(?im)^.*(?:private[ _-]?key|mnemonic|seed[ _-]?phrase|authorization|password|api[ _-]?key|access[ _-]?token|secret)[\x22\x27]?\s*[:=].*$", "[REDACTED_SENSITIVE_LINE]", text)
text = re.sub(r"(?i)(?:0x)?[a-f0-9]{64}", "[REDACTED_32_BYTE_VALUE]", text)
text = re.sub(r"(?i)(https?://)[^/\s@]+@", r"\1[REDACTED]@", text)
text = re.sub(r"(https?://[^\s?]+)\?[^\s]+", r"\1?[REDACTED_QUERY]", text)
text = "".join(c for c in text if c in "\n\t" or ord(c) >= 32)
sys.stdout.write(text)
'
}

diagnose_runtime() {
  local unit latest
  command -v python3 >/dev/null || { echo UNIFIED_DIAGNOSE_PYTHON_REQUIRED >&2; return 1; }
  echo UNIFIED_DIAGNOSE_READ_ONLY
  for unit in global-v3-compound-keeper-testnet global-v3-routed-compound-keeper-testnet \
    global-v3-hourly-compound-keeper-testnet global-v3-unified-keeper-testnet; do
    printf 'UNIFIED_DIAGNOSE_TIMER=%s.timer\n' "$unit"
    systemctl show "$unit.timer" --no-pager -p LoadState -p ActiveState -p SubState \
      -p UnitFileState -p LastTriggerUSec -p NextElapseUSecRealtime 2>&1 | redact_diagnostics || true
    printf 'UNIFIED_DIAGNOSE_SERVICE=%s.service\n' "$unit"
    systemctl show "$unit.service" --no-pager -p LoadState -p ActiveState -p Result \
      -p ExecMainStatus -p ExecMainExitTimestamp 2>&1 | redact_diagnostics || true
    journalctl --no-pager -o cat -u "$unit.service" -n 8 2>&1 | redact_diagnostics || true
  done
  # Read only the known deployment records, never a signer or environment file.
  python3 - "$public_state" <<'PY'
import json, os, re, stat, sys
from pathlib import Path
root = Path(sys.argv[1])
records = {
    "prototype": "v3-prototype/deployment.json",
    "routed": "v3-routed-testnet/deployment.json",
    "hourly": "v3-hourly-testnet/deployment.json",
    "unified": "v3-unified-testnet/deployment-proof.json",
    "unified_worker": "v3-unified-testnet/worker-ready.json",
}
addresses = {"vault", "contract", "token", "asset", "admin", "manager", "feeReceiver", "book", "network", "operator"}
hashes = {"runtimeHash", "vaultRuntimeHash", "bookRuntimeHash", "networkRuntimeHash", "txHash", "deploymentTx"}
numbers = {"chainId", "block", "blockNumber", "deploymentBlock", "accrualPeriodSeconds"}
for label, relative in records.items():
    filename = root / relative
    result = {"profile": label}
    try:
        if os.path.realpath(filename) != str(filename):
            raise ValueError()
        fd = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_size > 65536:
                raise ValueError()
            with os.fdopen(fd, "rb", closefd=False) as stream:
                data = json.load(stream)
        finally:
            os.close(fd)
        if not isinstance(data, dict):
            raise ValueError()
        result["record"] = "present"
        for key in addresses:
            value = data.get(key)
            if isinstance(value, str) and re.fullmatch(r"0x[a-fA-F0-9]{40}", value):
                result[key] = value
        for key in hashes:
            value = data.get(key)
            if isinstance(value, str) and re.fullmatch(r"0x[a-fA-F0-9]{64}", value):
                result[key] = value
        for key in numbers:
            value = data.get(key)
            if type(value) is int and 0 <= value <= 2**53 - 1:
                result[key] = value
        value = data.get("sourceSha")
        if isinstance(value, str) and re.fullmatch(r"[a-f0-9]{40}", value):
            result["sourceSha"] = value
    except FileNotFoundError:
        result["record"] = "missing"
    except (OSError, ValueError, TypeError, UnicodeError):
        result["record"] = "unreadable_or_invalid"
    print("UNIFIED_DIAGNOSE_LOCAL_PROOF " + json.dumps(result, sort_keys=True))
PY
  latest=''
  if [[ -d $state && ! -L $state && -f $state/latest && ! -L $state/latest &&
        $(stat -c %s -- "$state/latest") -le 160 ]]; then
    read -r latest < "$state/latest" || true
  fi
  if [[ $latest =~ $unit_pattern ]]; then
    report "$latest" || true
  else
    echo UNIFIED_DIAGNOSE_NO_RECORDED_RESUME
    journalctl --no-pager -o cat -u 'global-v3-unified-wallet-*' -n 80 2>&1 | redact_diagnostics || true
  fi
  echo UNIFIED_DIAGNOSE_COMPLETE_NO_CHANGES_NO_CHAIN_OR_WEBSITE_VERIFICATION
}

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
  # Include the actual failed phase, not just the final resume exit marker.
  journalctl --no-pager -o cat -u "$unit.service" -n 20 \
    --grep='^UNIFIED_' 2>&1 | redact_diagnostics || true
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
  # A Node stack can exceed 15 lines. Preserve bounded context containing the
  # original error instead of reporting only the runtime version and exit code.
  if (( result )); then journalctl --no-pager -o cat -u "$unit.service" -n 80 2>&1 | redact_diagnostics || true; fi
  return "$result"
}

resume_main() {
  local unit previous active result=0
  if [[ $(id -u) != 0 || $(hostname -s) != vps-luna-2585 ]]; then
    echo UNIFIED_RESUME_REQUIRES_ROOT_ON_VPS_LUNA_2585 >&2
    return 1
  fi
  if [[ ${1:-} == --diagnose ]]; then
    [[ $# == 1 ]] || { echo 'Usage: resume-v3-unified-wallet-site.sh [--status|--diagnose]' >&2; return 2; }
    diagnose_runtime
    return
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
    *) echo 'Usage: resume-v3-unified-wallet-site.sh [--status|--diagnose]' >&2; return 2 ;;
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

#!/usr/bin/env bash
# Reclaim only verified, unused one-shot build dependencies, then retry TESTNET.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname -s) == vps-luna-2585 ]] || {
  echo WRONG_SERVER_USE_VPS_LUNA_2585 >&2
  exit 1
}
here=$(cd -- "$(dirname -- "$0")" && pwd -P)
guard="$here/v3-inode-process-guard.py"
[[ -f $guard && ! -L $guard ]] || { echo PROCESS_GUARD_MISSING; exit 1; }

echo '=== CURRENT FILESYSTEM ==='
df -h /opt /root /var
df -i /opt /root /var

unit_file=/root/global-v3-team-unit
[[ -f $unit_file && ! -L $unit_file ]] || { echo TEAM_UNIT_FILE_NOT_FOUND; exit 1; }
failed_unit=$(cat "$unit_file")
[[ $failed_unit =~ ^global-v3-team-[0-9]+-[0-9]+\.service$ ]] || { echo TEAM_UNIT_INVALID; exit 1; }
state=$(systemctl show "$failed_unit" --property=ActiveState --value 2>/dev/null || true)
case "$state" in inactive|failed|'') ;; *) echo TEAM_UPDATE_STILL_RUNNING_OR_UNKNOWN; exit 1 ;; esac
logs=$(journalctl -u "$failed_unit" -n 250 --no-pager -o cat)
grep -Fq 'npm error code ENOSPC' <<< "$logs" || { echo ENOSPC_NOT_CONFIRMED; exit 1; }
grep -Fq 'Failed with result' <<< "$logs" || { echo TEAM_FAILURE_NOT_CONFIRMED; exit 1; }
release=$(printf '%s\n' "$logs" | sed -nE 's#^npm error path (/opt/global-v3-team\.[[:alnum:]]{6})/website/node_modules/\.bin$#\1#p' | tail -n 1)
[[ $release =~ ^/opt/global-v3-team\.[[:alnum:]]{6}$ && -d $release && ! -L $release &&
   -d $release/.git && ! -L $release/.git && -d $release/website && ! -L $release/website &&
   $(stat -c %u "$release") == 0 && $(stat -c %u "$release/website") == 0 &&
   $(git -C "$release" rev-parse HEAD) == b53e4d25f7f89a84a1244cdbba28f10c2014c9e8 ]] || {
  echo FAILED_RELEASE_NOT_VERIFIED
  exit 1
}

free_inodes(){ df --output=iavail /opt | tail -n 1 | tr -d '[:space:]'; }
available=$(free_inodes)
[[ $available =~ ^[0-9]+$ ]] || { echo INODE_COUNT_UNAVAILABLE; exit 1; }

# These are the only two known one-shot website build releases. Their unit logs
# must prove the exact revision was successfully installed before cleanup.
shopt -s nullglob
for old in /opt/global-v3-history.?????? /opt/global-v3-wallet-fee.??????; do
  (( available < 180000 )) || break
  [[ -d $old && ! -L $old && -d $old/.git && ! -L $old/.git &&
     -d $old/website && ! -L $old/website &&
     $(stat -c %u "$old") == 0 && $(stat -c %u "$old/website") == 0 &&
     $(stat -c %d "$old") == $(stat -c %d /opt) ]] || continue
  case "$old" in
    /opt/global-v3-history.??????)
      expected=ee3f73ea1c3728f5a00c3fe799ca87cbfd767f3b
      old_unit_file=/root/global-v3-history-unit ;;
    /opt/global-v3-wallet-fee.??????)
      expected=d19bb3845f4e73517599dd1c02abbb84ac4ded4b
      old_unit_file=/root/global-v3-wallet-fee-unit ;;
    *) continue ;;
  esac
  [[ $old =~ ^/opt/global-v3-(history|wallet-fee)\.[[:alnum:]]{6}$ &&
     $(git -C "$old" rev-parse HEAD 2>/dev/null || true) == "$expected" ]] || continue
  git -C "$old" diff --quiet HEAD -- || continue
  [[ -f $old_unit_file && ! -L $old_unit_file ]] || continue
  old_unit=$(cat "$old_unit_file")
  [[ $old_unit =~ ^global-v3-(history|wallet-fee)-[[:alnum:]-]+\.service$ ]] || continue
  old_state=$(systemctl show "$old_unit" --property=ActiveState --value 2>/dev/null || true)
  case "$old_state" in inactive|failed|'') ;; *) continue ;; esac
  old_log=$(journalctl -u "$old_unit" -n 500 --no-pager -o cat)
  grep -Fq 'V3_HOURLY_WALLET_SITE_UPDATED=' <<< "$old_log" || continue
  grep -Fq "V3_HOURLY_UPDATE_RELEASE_SHA=$expected" <<< "$old_log" || continue

  # Do not remove dependencies referenced by service or cron configuration.
  config_paths=()
  for path in /etc/systemd/system /run/systemd/system /run/systemd/transient \
    /lib/systemd/system /usr/lib/systemd/system /etc/nginx /etc/default /etc/crontab \
    /etc/cron.d /etc/cron.daily /etc/cron.hourly /var/spool/cron; do
    [[ -e $path ]] && config_paths+=("$path")
  done
  if (( ${#config_paths[@]} )); then
    if grep -rqsF -- "$old" "${config_paths[@]}"; then
      echo "SKIP_REFERENCED_RELEASE=$old"
      continue
    else
      status=$?
      [[ $status == 1 ]] || { echo CONFIG_CHECK_UNAVAILABLE; continue; }
    fi
  fi
  if ! timeout 20s python3 "$guard" "$old"; then
    echo "SKIP_BUSY_RELEASE=$old"
    continue
  fi
  if ! timeout 20s python3 "$guard" --web-links "$old"; then
    echo "SKIP_WEBROOT_CHECK=$old"
    continue
  fi

  for item in "$old/node_modules" "$old/website/node_modules"; do
    if [[ -d $item && ! -L $item && $(stat -c %u "$item") == 0 &&
       $(stat -c %d "$item") == $(stat -c %d /opt) ]]; then
      command -v mountpoint >/dev/null || { echo MOUNT_CHECK_UNAVAILABLE; continue; }
      if mountpoint -q "$item"; then
        echo "SKIP_MOUNTED_DEPENDENCIES=$item"
        continue
      else
        status=$?
        [[ $status == 32 ]] || { echo MOUNT_CHECK_UNAVAILABLE; continue; }
      fi
      du --inodes -s "$item" || true
      rm -rf --one-file-system -- "$item"
      echo "CLEANED_TEMP_DEPENDENCIES=$item"
    fi
  done
  available=$(free_inodes)
  [[ $available =~ ^[0-9]+$ ]] || { echo INODE_COUNT_UNAVAILABLE; exit 1; }
done

echo '=== AFTER CLEANUP ==='
df -h /opt /root /var
df -i /opt /root /var
# Conservative limits: fail closed and request inspection if still short.
for spec in '/opt:3221225472:180000' '/root:1073741824:30000' '/var:536870912:5000'; do
  IFS=: read -r path min_bytes min_inodes <<< "$spec"
  bytes=$(df -B1 --output=avail "$path" | tail -n 1 | tr -d '[:space:]')
  inodes=$(df --output=iavail "$path" | tail -n 1 | tr -d '[:space:]')
  if [[ ! $bytes =~ ^[0-9]+$ || ! $inodes =~ ^[0-9]+$ ]] || (( bytes < min_bytes || inodes < min_inodes )); then
    echo NEED_MORE_SPACE_OR_INODES
    exit 2
  fi
done

echo '=== RETRY TESTNET SITE UPDATE ==='
unit="global-v3-team-$(date +%s)-$$"
printf '%s.service\n' "$unit" > "$unit_file"
result=0
systemd-run --unit="$unit" --collect --wait --property=TimeoutStartSec=1800 \
  /bin/bash "$release/scripts/update-v3-hourly-wallet-site.sh" --install || result=$?
journalctl -u "$unit.service" -n 35 --no-pager -o cat || true
exit "$result"

#!/usr/bin/env bash
# Align payment and failover sources without interrupting financial work.
set +x
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$#" -eq 3 ] && [ "$1" = --execute ] && [ "$2" = --wallet ] || { echo 'Usage: bash ubuntu-sync-hourly-worker.sh --execute --wallet 0xADDRESS'; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo 'ROOT_REQUIRED'; exit 1; }
wallet=$3
[[ "$wallet" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo 'PUBLIC_WALLET_REQUIRED'; exit 1; }
install -d -m 700 /var/lib/globaldroptrade/worker-sync-v1
exec 8>/var/lib/globaldroptrade/worker-sync-v1/run.lock
flock -n 8 || { echo 'WORKER_SYNC_BUSY'; exit 75; }
worker=globaldroptrade-zero-daily
monitor=globaldroptrade-rpc-failover
worker_timer_before=$(systemctl is-active "$worker.timer" 2>/dev/null || true)
monitor_timer_before=$(systemctl is-active "$monitor.timer" 2>/dev/null || true)
phase=QUIESCING
cleanup(){
 result=$?
 if [ "$result" -ne 0 ]; then
  echo "WORKER_SYNC_FAILED phase=$phase exit=$result"
  if [ "$phase" = QUIESCING ]; then
   if [ "$worker_timer_before" = active ]; then systemctl start "$worker.timer" || true; fi
   if [ "$monitor_timer_before" = active ]; then systemctl start "$monitor.timer" || true; fi
  else
   echo 'RPC_FAILOVER_LEFT_PAUSED: review installation output before resuming an older repair source.'
  fi
 fi
}
trap cleanup EXIT
systemctl stop "$monitor.timer"
systemctl stop "$worker.timer"
# Stopping timers does not kill a service or a signed transaction. Wait for the
# old failover transition before it can overwrite the newly installed worker.
wait_idle(){
 local unit=$1 state attempt
 for ((attempt=0;attempt<180;attempt++)); do
  state=$(systemctl show "$unit" --property=ActiveState --value)
  case "$state" in
   inactive|failed|'') return 0;;
   active|activating|deactivating|reloading)
    if ((attempt%6==0)); then echo "WORKER_SYNC_WAITING unit=$unit"; fi
    sleep 5;;
   *) echo 'WORKER_SYNC_UNKNOWN_SERVICE_STATE'; return 1;;
  esac
 done
 echo 'WORKER_SYNC_SERVICE_STILL_BUSY';return 75
}
wait_idle "$monitor.service"
# A finishing old RPC repair may have restarted the payment timer.
systemctl stop "$worker.timer"
wait_idle "$worker.service"
phase=INSTALLING_WORKER
bash ubuntu-position-hourly.sh --execute
phase=VERIFYING_WORKER
for name in daily-profit.mjs position-profit.mjs zero-start-automation.mjs complete-rpc-logs.mjs; do
 if ! cmp -s "scripts/$name" "/opt/globaldroptrade-zero-daily/current/scripts/$name"; then
  systemctl stop "$worker.timer"
  echo "WORKER_SYNC_SOURCE_MISMATCH file=$name";exit 1
 fi
 echo "WORKER_SOURCE_MATCH_$name=true"
done
phase=INSTALLING_FAILOVER
# Its future repairs must use the same reviewed source as the payment worker.
bash ubuntu-install-rpc-failover.sh --execute
phase=VERIFYING_FAILOVER
monitor_source=$(systemctl show "$monitor.service" --property=WorkingDirectory --value)
case "$monitor_source" in /opt/globaldroptrade-rpc-failover/releases/*) ;; *) echo 'MANAGED_FAILOVER_RELEASE_REQUIRED';exit 1;; esac
for name in daily-profit.mjs position-profit.mjs zero-start-automation.mjs complete-rpc-logs.mjs zero-rpc-failover.py; do
 cmp -s "scripts/$name" "$monitor_source/scripts/$name" || { echo "FAILOVER_SOURCE_MISMATCH file=$name";exit 1; }
done
echo 'WORKER_AND_FAILOVER_SOURCES_ALIGNED'
phase=READ_ONLY_AUDIT
if bash ubuntu-check-hourly-payments.sh --wallet "$wallet"; then
 echo 'WORKER_SYNC_COMPLETE: inspect verified receipts; alignment alone does not prove backlog settlement.'
else
 echo 'WORKER_SYNC_COMPLETE_AUDIT_WAITING: reviewed sources installed; live RPC or worker availability still needs inspection.'
fi
phase=COMPLETE

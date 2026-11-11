#!/usr/bin/env python3
"""Wait for a current testnet-ready report, then invoke the guarded installer once."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

TARGET = '0x4c0f6141b18971db4b14e45c0be8cddb09febc14'
ROOT = Path(__file__).resolve().parent.parent
INSTALLER = ROOT / 'scripts/install-integrated-index-scan.py'


def status_state(value, now):
    if not isinstance(value, dict):
        return 'wait'
    if value.get('chainId') != 97 or str(value.get('vaultAddress', '')).lower() != TARGET:
        raise RuntimeError('INDEX_WAIT_TARGET_MISMATCH')
    blockers = value.get('blockers')
    if not isinstance(blockers, list) or any(not isinstance(x, str) for x in blockers):
        return 'wait'
    try:
        raw = value.get('checkedAt')
        if not isinstance(raw, str):
            return 'wait'
        dt = datetime.fromisoformat(raw.replace('Z', '+00:00'))
        if dt.tzinfo is None:
            return 'wait'
        age = now - dt.timestamp()
    except (ValueError, OverflowError):
        return 'wait'
    if not -30 <= age <= 120 or value.get('fresh') is not True:
        return 'wait'
    if value.get('schedulerActive') is not True:
        raise RuntimeError('INDEX_WAIT_SCHEDULER_INACTIVE')
    unsupported = [x for x in blockers if x != 'DAILY_MEMBER_INDEX_INCOMPLETE']
    if unsupported:
        raise RuntimeError('INDEX_WAIT_OTHER_BLOCKER')
    if blockers == [] and value.get('dailyStatus') in ('ready', 'not_due'):
        return 'ready'
    return 'wait'


def read_status(timeout):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    request = urllib.request.Request('http://127.0.0.1:3115/api/automation/status',
                                     headers={'Cache-Control': 'no-store'})
    with opener.open(request, timeout=timeout) as response:
        return json.load(response)


def run_when_ready(read, run_stage, *, wall=time.time, clock=time.monotonic,
                   sleep=time.sleep, max_wait=600, interval=20):
    if not 1 <= max_wait <= 600 or not 1 <= interval <= 30:
        raise RuntimeError('INDEX_WAIT_INVALID_LIMIT')
    deadline = clock() + max_wait
    while True:
        remaining = deadline - clock()
        if remaining <= 0:
            raise RuntimeError('INDEX_WAIT_TIMEOUT_NO_INSTALL')
        try:
            report = read(min(8, remaining))
        except (OSError, ValueError, urllib.error.URLError):
            report = None
        if clock() >= deadline:
            raise RuntimeError('INDEX_WAIT_TIMEOUT_NO_INSTALL')
        state = status_state(report, wall())
        if state == 'ready':
            print('INDEX_WAIT_READY_CHECKING_INSTALLER', flush=True)
            # Never retry either phase. The installer repeats its own target,
            # service, lock and timer-window checks immediately before action.
            run_stage('--check')
            remaining = deadline - clock()
            if remaining <= 0:
                raise RuntimeError('INDEX_WAIT_TIMEOUT_NO_INSTALL')
            try:
                confirmed = read(min(8, remaining))
            except (OSError, ValueError, urllib.error.URLError):
                raise RuntimeError('INDEX_WAIT_STATUS_CHANGED_NO_INSTALL') from None
            if clock() >= deadline or status_state(confirmed, wall()) != 'ready':
                raise RuntimeError('INDEX_WAIT_STATUS_CHANGED_NO_INSTALL')
            run_stage('--execute')
            return
        print('INDEX_WAIT_NOT_READY', flush=True)
        remaining = deadline - clock()
        if remaining <= 0:
            raise RuntimeError('INDEX_WAIT_TIMEOUT_NO_INSTALL')
        sleep(min(interval, remaining))


def main():
    if os.geteuid() != 0 or len(sys.argv) != 2 or sys.argv[1] != '--execute':
        raise RuntimeError('INDEX_WAIT_EXPLICIT_ROOT_EXECUTE_REQUIRED')
    if not INSTALLER.is_file():
        raise RuntimeError('INDEX_WAIT_INSTALLER_MISSING')
    def stage(mode):
        subprocess.run([sys.executable, str(INSTALLER), mode], cwd=ROOT, check=True)
    run_when_ready(read_status, stage)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('INDEX_WAIT_INTERRUPTED_INSPECT_BEFORE_RETRY', flush=True)
        raise SystemExit(130)
    except subprocess.CalledProcessError:
        print('INDEX_WAIT_INSTALLER_STOPPED_INSPECT_BEFORE_RETRY', flush=True)
        raise SystemExit(1)
    except Exception as error:
        text = str(error)
        print(text if text.startswith('INDEX_WAIT_') else 'INDEX_WAIT_STOPPED', flush=True)
        raise SystemExit(1)

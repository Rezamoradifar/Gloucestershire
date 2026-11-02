#!/usr/bin/env python3
"""Sequence existing verified testnet services; never open a key or send a transaction."""
import fcntl
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import time

ROOT = Path('/var/lib/globaldroptrade/smart-worker-v1')
JOURNAL = Path('/var/lib/globaldroptrade/fresh-fast-testnet-automation-v1/journal.json')
STATUS = JOURNAL.parent/'status.json'
INDEX = 'globaldroptrade-position-index.service'
PAYMENT = 'globaldroptrade-zero-daily.service'
LEGACY_TIMERS = ('globaldroptrade-position-index.timer', 'globaldroptrade-zero-daily.timer')
BUSY = ('active', 'activating', 'deactivating', 'reloading')

def read_json(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd) as stream:
        meta = os.fstat(stream.fileno())
        if not stat.S_ISREG(meta.st_mode) or meta.st_uid != 0 or meta.st_mode & 0o077 or meta.st_size > 16777216:
            raise ValueError('SMART_PRIVATE_STATE_REQUIRED')
        return json.load(stream)

def progress(journal):
    daily = journal.get('daily', {})
    return {'memberThrough': daily.get('registry', {}).get('through'),
            'positionThrough': daily.get('positionIndex', {}).get('through'),
            'target': daily.get('positionScanTarget', {}).get('number'),
            'paidHours': sum(daily.get('positionPaid', {}).values()),
            'paidQuarters': sum(daily.get('positionQuarterPaid', {}).values())}

def run_cycle(control, load, previous=None, clock=time.time):
    report = {'version': 1, 'chainId': 97, 'checkedAt': int(clock()),
              'status': 'waiting', 'steps': [], 'blockers': [],
              'coordinatorTransactionsSent': 0, 'coordinatorSignerOpened': False}
    # Wait for an existing financial execution without terminating it. The
    # systemctl client can wait indefinitely; it never owns the signed bytes.
    for unit in (PAYMENT, INDEX, 'globaldroptrade-rpc-failover.service'):
        if control('active', unit) in BUSY:
            report['blockers'] = ['EXISTING_SERVICE_RUNNING']
            return report
    prior_status = load('status')
    before = progress(load('journal'))
    for unit in (INDEX, PAYMENT):
        outcome = control('start', unit)
        report['steps'].append({'service': unit, 'success': outcome == 0})
        # A failed index read does not prevent the financial worker from
        # reconciling pending transactions or paying approved withdrawals.
    after = progress(load('journal'))
    status = load('status')
    report.update({'before': before, 'after': after,
                   'paymentStatus': status.get('status'),
                   'dailyStatus': status.get('dailyStatus')})
    report['blockers'] = list(dict.fromkeys(
        x for x in status.get('blockers', []) + status.get('errors', [])
        if isinstance(x, str) and x.replace('_', '').isalnum() and x.upper() == x))
    backlog = (isinstance(after['target'], int) and
               isinstance(after['positionThrough'], int) and
               after['positionThrough'] < after['target'])
    stalled = backlog and before == after
    prior = previous or {}
    same = prior.get('after') == after
    report['stalledCycles'] = (prior.get('stalledCycles', 0) if same else 0) + 1 if stalled else 0
    if report['stalledCycles'] >= 3:
        report['blockers'].append('INDEX_PROGRESS_STALLED')
    if any(not step['success'] for step in report['steps']):
        report['blockers'].append('SERVICE_REPORTED_FAILURE')
    report['status'] = 'waiting' if report['blockers'] else 'running'
    # Copy only receipt references, not private configuration or journal data.
    fresh = status.get('checkedAt') is not None and status.get('checkedAt') != prior_status.get('checkedAt')
    if not fresh:
        report['blockers'].append('PAYMENT_STATUS_NOT_REFRESHED')
        report['status'] = 'waiting'
    report['newCreditTransactionHashes'] = list(dict.fromkeys(
        row['transactionHash'] for row in status.get('dailyCredits', [])
        if fresh and report['steps'][-1]['success'] and row.get('status') == 'credited' and
        isinstance(row.get('transactionHash'), str) and
        len(row['transactionHash']) == 66 and row['transactionHash'].startswith('0x') and
        all(c in '0123456789abcdefABCDEF' for c in row['transactionHash'][2:])))
    return report

def main():
    if os.geteuid() != 0:
        raise ValueError('ROOT_REQUIRED')
    os.umask(0o077)
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    meta = ROOT.lstat()
    if not stat.S_ISDIR(meta.st_mode) or meta.st_uid != 0 or meta.st_mode & 0o077:
        raise ValueError('SMART_PRIVATE_DIRECTORY_REQUIRED')
    fd = os.open(ROOT/'run.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        if not stat.S_ISREG(os.fstat(lock.fileno()).st_mode):
            raise ValueError('SMART_PRIVATE_LOCK_REQUIRED')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('SMART_WORKER_BUSY')
            return
        def control(action, unit):
            if action == 'active':
                return subprocess.run(['systemctl', 'show', unit, '-p', 'ActiveState', '--value'], capture_output=True, text=True, check=True).stdout.strip()
            if action == 'start':
                return subprocess.run(['systemctl', 'start', unit], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False).returncode
            raise ValueError('SMART_CONTROL_ACTION_INVALID')
        # Reconcile legacy timer drift after a verified RPC installer ran.
        for unit in LEGACY_TIMERS:
            subprocess.run(['systemctl', 'stop', unit], check=True, stdout=subprocess.DEVNULL)
        try:
            previous = read_json(ROOT/'status.json')
        except FileNotFoundError:
            previous = {}
        report = run_cycle(control, lambda kind: read_json(JOURNAL if kind == 'journal' else STATUS), previous)
        descriptor, name = tempfile.mkstemp(dir=ROOT, prefix='status-')
        try:
            with os.fdopen(descriptor, 'w') as stream:
                json.dump(report, stream, separators=(',', ':'));stream.flush();os.fsync(stream.fileno())
            os.replace(name, ROOT/'status.json')
        finally:
            if os.path.exists(name):os.unlink(name)
        print('SMART_WORKER_STATUS ' + json.dumps(report, separators=(',', ':')))

if __name__ == '__main__':
    try:main()
    except Exception:
        print('SMART_WORKER_WAITING STATE_OR_SERVICE_CHECK_FAILED')
        raise SystemExit(1)

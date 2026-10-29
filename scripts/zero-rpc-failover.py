#!/usr/bin/env python3
"""Rotate testnet RPC configuration only after the existing full readiness proof."""
import fcntl
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile

CANDIDATES = (
    ('bnb-dataseed', 'https://bsc-testnet-dataseed.bnbchain.org'),
    ('bnb-testnet', 'https://bsc-testnet.bnbchain.org'),
    ('bnb-prebsc', 'https://data-seed-prebsc-1-s1.bnbchain.org:8545'),
)
STATE = Path('/var/lib/globaldroptrade/rpc-failover-v1')
SERVICE = 'globaldroptrade-zero-daily.service'


def rotate(probe, apply, candidates=CANDIDATES):
    attempts = []
    for name, url in candidates:
        if not probe(url):
            attempts.append({'candidate': name, 'verified': False})
            continue
        # The apply path rechecks readiness under locks. Never try another
        # endpoint after an apply failure: a worker may already have run.
        success = apply(url)
        attempts.append({'candidate': name, 'verified': True})
        return {'status': 'updated' if success else 'apply-failed',
                'selected': name, 'attempts': attempts}
    return {'status': 'no-verified-candidate', 'attempts': attempts}


def needs_rotation(activation, exit_code):
    a = activation.get('automation', {})
    blockers = a.get('blockers', [])
    return exit_code == '1' or any(isinstance(x, str) and
        (x.endswith('_RPC_UNAVAILABLE') or x in (
            'ZERO_START_RECEIPT_REQUIRED', 'ZERO_START_TRANSACTION_MISMATCH'))
        for x in blockers)


def trusted_directory(path):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    s = path.lstat()
    if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o077:
        raise ValueError('PRIVATE_RPC_FAILOVER_DIRECTORY_REQUIRED')


def main():
    if os.geteuid() != 0:
        raise ValueError('ROOT_REQUIRED')
    os.umask(0o077)
    trusted_directory(STATE)
    fd = os.open(STATE/'run.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('RPC_FAILOVER_BUSY')
            return
        def system_value(*args):
            return subprocess.run(['systemctl', *args], capture_output=True,
                                  text=True, check=False).stdout.strip()
        if system_value('is-active', SERVICE) in ('active', 'activating', 'deactivating'):
            print('RPC_FAILOVER_WORKER_BUSY')
            return
        try:
            activation = json.loads(Path('/var/www/globaldroptrade/automation-data/activation.json').read_text())
        except (OSError, ValueError):
            print('RPC_FAILOVER_STATUS_REQUIRED')
            return
        code = system_value('show', SERVICE, '--property=ExecMainStatus', '--value')
        if not needs_rotation(activation, code):
            print('RPC_FAILOVER_CURRENT_WORKER_NO_RPC_BLOCKER')
            return
        release = Path(__file__).resolve().parents[1]
        repair = release/'ubuntu-zero-archive-rpc.sh'
        try:
            prior_report = json.loads((STATE/'status.json').read_text())
        except (OSError, ValueError):
            prior_report = {}
        if prior_report.get('status') in ('apply-failed', 'apply-in-progress'):
            print('RPC_FAILOVER_APPLY_RECOVERY_REQUIRED')
            return
        previous = prior_report.get('lastSelected')
        names = [name for name, _ in CANDIDATES]
        offset = (names.index(previous)+1) % len(names) if previous in names else 0
        ordered = CANDIDATES[offset:]+CANDIDATES[:offset]
        candidate_fd, candidate_name = tempfile.mkstemp(prefix='candidate-', dir=STATE)
        os.close(candidate_fd)
        candidate = Path(candidate_name)
        log_fd, log_name = tempfile.mkstemp(prefix='check-', suffix='.log', dir=STATE)
        try:
            with os.fdopen(log_fd, 'w') as log:
                def invoke(url, mode):
                    candidate.write_text(url+'\n')
                    if mode == '--execute':
                        marker = STATE/'status.next.json'
                        marker.write_text(json.dumps({'status':'apply-in-progress',
                            'lastSelected':previous})+'\n')
                        os.replace(marker, STATE/'status.json')
                    result = subprocess.run(['bash', str(repair), mode,
                        '--receipt-rpc-replacement', '--candidate-file', str(candidate)],
                        stdout=log, stderr=subprocess.STDOUT, check=False)
                    log.flush()
                    return result.returncode == 0
                report = rotate(lambda url: invoke(url, '--check'),
                                lambda url: invoke(url, '--execute'), ordered)
            report['lastSelected'] = report.get('selected', previous)
            report['logFile'] = log_name
            target = STATE/'status.json'
            temp = STATE/'status.next.json'
            temp.write_text(json.dumps(report, indent=2)+'\n')
            os.replace(temp, target)
            print('RPC_FAILOVER_'+report['status'].upper().replace('-', '_'))
            if report.get('selected'):
                print('RPC_FAILOVER_SELECTED='+report['selected'])
        finally:
            candidate.unlink(missing_ok=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Never print provider responses, credentials or subprocess exceptions.
        print('RPC_FAILOVER_CHECK_FAILED')
        raise SystemExit(1)

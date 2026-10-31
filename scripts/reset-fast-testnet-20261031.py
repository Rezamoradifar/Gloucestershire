#!/usr/bin/env python3
"""One resumable, explicitly authorized replacement of the known testnet generation."""
import contextlib
import fcntl
import hashlib
import json
import os
import re
import socket
from pathlib import Path
import stat
import subprocess
import sys
import time

OLD = '0xfa53c3337825cde4f760a6fa45a87d8a7b353f75'
NAMES = ('fresh-fast-testnet-v1', 'fresh-fast-testnet-automation-v1')
BASE = Path('/var/lib/globaldroptrade')
SESSION = BASE/'fresh-fast-reset-20261031'
REPO = Path(__file__).resolve().parent.parent


def private(path, directory=False):
    s = path.lstat()
    if s.st_uid != os.getuid() or s.st_mode & 0o077 or not (stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode)):
        raise RuntimeError('RESET_PRIVATE_REGULAR_INPUT_REQUIRED path='+str(path))


def digest(path):
    private(path)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, value):
    import tempfile
    fd, name = tempfile.mkstemp(prefix='.'+path.name+'-', dir=path.parent)
    tmp = Path(name)
    with os.fdopen(fd, 'w') as f:
        json.dump(value, f); f.flush(); os.fsync(f.fileno())
    os.replace(tmp, path)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)


def settled(path):
    if not path.exists(): return
    private(path)
    j = json.loads(path.read_text())
    if not isinstance(j, dict) or not isinstance(j.get('transactions', {}), dict):
        raise RuntimeError('RESET_JOURNAL_REVIEW_REQUIRED')
    if j.get('pending') or (isinstance(j.get('oracle'), dict) and j['oracle'].get('pending')):
        raise RuntimeError('RESET_PENDING_TRANSACTION_RESUME_OLD_WORKER_FIRST')
    for entry in j.get('transactions', {}).values():
        if not isinstance(entry, dict) or type(entry.get('block')) is not int or entry['block'] < 1:
            raise RuntimeError('RESET_PENDING_TRANSACTION_RESUME_OLD_WORKER_FIRST')


def plan_archive(base, session):
    """Freeze a file manifest before moving anything; preserve lock inodes."""
    files = []
    preserved_backups = []
    for name in NAMES:
        root = base/name; private(root, True); settled(root/'journal.json')
        for p in sorted(root.iterdir()):
            # Installer recovery folders remain in place; they are not live generation state.
            # Use lstat so a symlink can never masquerade as a recognized backup.
            if stat.S_ISDIR(p.lstat().st_mode):
                private(p, True)
                if name != NAMES[1] or not re.fullmatch(r'install-[0-9]{8}T[0-9]{6}-[0-9]+', p.name):
                    raise RuntimeError('RESET_UNEXPECTED_STATE_DIRECTORY path='+str(p))
                preserved_backups.append(name+'/'+p.name)
                continue
            if p.name.endswith('.lock'):
                private(p); continue
            files.append({'path': name+'/'+p.name, 'sha256': digest(p)})
    policy = json.loads((base/NAMES[1]/'daily-policy.json').read_text())
    if policy.get('chainId') != 97 or policy.get('vaultAddress', '').lower() != OLD:
        raise RuntimeError('RESET_EXPECTED_OLD_TESTNET_REQUIRED')
    report = json.loads((base/NAMES[0]/'deployment-public.json').read_text())
    if report.get('chainId') != 97 or report.get('contractAddress', '').lower() != OLD:
        raise RuntimeError('RESET_OLD_DEPLOYMENT_MISMATCH')
    value = {'version': 1, 'oldTarget': OLD, 'phase': 'archiving', 'files': files, 'preservedInstallerBackups': preserved_backups}
    save(session/'session.json', value)
    return value


def archive(base, session, state):
    for row in state['files']:
        relative = Path(row['path'])
        if len(relative.parts) != 2 or relative.parts[0] not in NAMES or relative.name.endswith('.lock'):
            raise RuntimeError('RESET_ARCHIVE_MANIFEST_INVALID')
        source, target = base/relative, session/'previous-state'/relative
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        private(target.parent, True)
        if target.exists():
            if digest(target) != row['sha256'] or source.exists():
                raise RuntimeError('RESET_ARCHIVE_CONFLICT')
        else:
            if digest(source) != row['sha256']: raise RuntimeError('RESET_ARCHIVE_INPUT_CHANGED')
            os.rename(source, target)
    state['phase'] = 'archived'; save(session/'session.json', state)


@contextlib.contextmanager
def locks(paths):
    handles = []
    try:
        for path in paths:
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700); private(path.parent, True)
            fd = os.open(path, os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW, 0o600)
            handles.append(fd); private(path)
            fcntl.flock(fd, fcntl.LOCK_EX|fcntl.LOCK_NB)
        yield
    finally:
        for fd in reversed(handles): os.close(fd)


def run(*args):
    subprocess.run(args, cwd=REPO, check=True)


def unit_state(unit):
    return subprocess.check_output(['systemctl','show','--property=ActiveState','--value',unit],text=True).strip()


def quiesce():
    run('systemctl','stop','globaldroptrade-rpc-failover.timer')
    # A failover transition can restart or overwrite the payment worker.
    for attempt in range(181):
        active = unit_state('globaldroptrade-rpc-failover.service')
        if active in ('inactive','failed',''): break
        if active not in ('active','activating') or attempt == 180: raise RuntimeError('RESET_RPC_TRANSITION_BUSY_RETRY_SAME_COMMAND')
        if attempt % 30 == 0: print('RESET_WAITING_FOR_RPC_TRANSITION', flush=True)
        time.sleep(1)
    run('systemctl','stop','globaldroptrade-zero-daily.timer')
    # Never terminate a worker while it may be signing or broadcasting.
    for attempt in range(181):
        active = unit_state('globaldroptrade-zero-daily.service')
        if active in ('inactive','failed'): break
        if active not in ('active','activating') or attempt == 180: raise RuntimeError('RESET_WORKER_BUSY_RETRY_SAME_COMMAND')
        if attempt % 30 == 0: print('RESET_WAITING_FOR_CURRENT_WORKER', flush=True)
        time.sleep(1)
    for unit in ('globaldroptrade-migration.service','globaldroptrade-fresh-rewards.service',
                 'globaldroptrade-automation.timer','globaldroptrade-oracles.timer',
                 'globaldroptrade-automation.service','globaldroptrade-oracles.service'):
        if unit_state(unit) not in ('inactive','failed'): raise RuntimeError('RESET_OTHER_WORKER_ACTIVE')


def main():
    if sys.argv[1:] != ['--execute'] or os.getuid() != 0: raise RuntimeError('RESET_ROOT_EXPLICIT_EXECUTE_REQUIRED')
    if socket.gethostname().split('.', 1)[0] == 'vps-titan-5320':
        raise RuntimeError('RESET_ISOLATED_SHARED_HOST_RUNTIME_REQUIRED')
    os.umask(0o077)
    SESSION.mkdir(mode=0o700, exist_ok=True); private(SESSION, True)
    with locks([SESSION/'run.lock']):
        f = SESSION/'session.json'
        state = None
        if f.exists():
            private(f); state = json.loads(f.read_text())
            if state.get('version') != 1 or state.get('oldTarget') != OLD or state.get('phase') not in ('archiving','archived','deployed','connected','complete'): raise RuntimeError('RESET_SESSION_IDENTITY_MISMATCH')
            if state.get('phase') == 'complete':
                print('RESET_ALREADY_COMPLETE target='+state['newTarget']); return
        # Confirm the actual endpoint is testnet before retiring any active files.
        run('node','--input-type=module','-e',
            "import fs from 'node:fs';import{parseEnv}from'node:util';import{FetchRequest,JsonRpcProvider}from'ethers';const e=parseEnv(fs.readFileSync('/etc/globaldroptrade/trades.env','utf8'));if(e.TRADES_CHAIN_ID!=='97'||!e.TRADES_RPC_URL)throw Error('RESET_TESTNET_RPC_REQUIRED');const r=new FetchRequest(e.TRADES_RPC_URL);r.timeout=15000;const p=new JsonRpcProvider(r,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});try{if(Number(await p.send('eth_chainId',[]))!==97||!await p.getBlock('latest'))throw Error('RESET_TESTNET_RPC_REQUIRED');console.log('RESET_TESTNET_RPC_PREFLIGHT_VALID');}finally{await p.destroy();}")
        quiesce()
        if state is None or state['phase'] == 'archiving':
            names = [BASE/'fast-testnet-setup-v1/setup.lock', BASE/'zero-oracle-repair-v1/setup.lock',
                     BASE/'fresh-fast-testnet-connection/run.lock',
                     BASE/'worker-sync-v1/run.lock']
            names += [BASE/name/lock for name in NAMES for lock in ('setup.lock','run.lock')]
            with locks(names):
                if state is None:
                    run('node','--input-type=module','-e',
                        "import fs from 'node:fs';import{parseEnv}from'node:util';const e=parseEnv(fs.readFileSync('/etc/globaldroptrade/trades.env','utf8'));if(e.TRADES_CHAIN_ID!=='97'||e.TRADES_VAULT_ADDRESS?.toLowerCase()!=='"+OLD+"'||e.TRADES_ZERO_START_PROFILE!=='global-fresh-fast-test-v1')throw Error('RESET_ACTIVE_OLD_TESTNET_REQUIRED');")
                    # Keep the existing private environment and service files for manual recovery.
                    for name in ('trades.env',):
                        source=Path('/etc/globaldroptrade')/name; private(source)
                        target=SESSION/name
                        if target.exists():
                            if digest(target) != digest(source): raise RuntimeError('RESET_BACKUP_CHANGED_REVIEW')
                        else:
                            target.write_bytes(source.read_bytes()); target.chmod(0o600)
                    state = plan_archive(BASE, SESSION)
                archive(BASE, SESSION, state)
            print('RESET_OLD_STATE_ARCHIVED backup='+str(SESSION), flush=True)
        if state['phase'] == 'archived':
            run('bash','ubuntu-deploy-zero-start.sh','--execute','--fast-testnet')
            report=json.loads((BASE/NAMES[0]/'deployment-public.json').read_text())
            target=report.get('contractAddress','')
            if report.get('chainId') != 97 or target.lower() == OLD or report.get('emptyAtDeployment') is not True:
                raise RuntimeError('RESET_NEW_EMPTY_DEPLOYMENT_REQUIRED')
            state.update(phase='deployed',newTarget=target); save(f,state)
        if state['phase'] == 'deployed':
            run('bash','ubuntu-connect-zero-start.sh','--fast-testnet')
            state['phase']='connected'; save(f,state)
        if state['phase'] == 'connected':
            # Existing reviewed installer refreshes feeds and starts a new hourly policy.
            # Fund the new generation once with the previously requested test-only budget.
            run('bash','ubuntu-zero-oracle.sh','--execute','--hourly-test','--fund-test-million')
            policy=json.loads((BASE/NAMES[1]/'daily-policy.json').read_text())
            if policy.get('chainId') != 97 or policy.get('vaultAddress') != state['newTarget'] or policy.get('periodSeconds') != 3600:
                raise RuntimeError('RESET_NEW_HOURLY_POLICY_REQUIRED')
            # Use the same independently timed position-hour policy on the fresh address.
            run('bash','ubuntu-position-hourly.sh','--execute','--expected-target',state['newTarget'])
            policy=json.loads((BASE/NAMES[1]/'daily-policy.json').read_text())
            if policy.get('basis') != 'position-anniversary-principal' or policy.get('positionScheduleVersion') != 1:
                raise RuntimeError('RESET_POSITION_POLICY_REQUIRED')
            # Future RPC repairs must carry the same reviewed funded worker source.
            run('bash','ubuntu-install-rpc-failover.sh','--execute')
            state['phase']='complete'; save(f,state)
        print('RESET_COMPLETE target='+state['newTarget'])
        print('OLD_ACCOUNTS_MIGRATED=false HOURLY_TEST=true TEST_REWARD_TOPUP=1000000_TEST_USDT')
        print('Fresh deposits and reinvestments earn after their own complete test hour. Inspect the worker status for funding or RPC blockers.')


if __name__ == '__main__':
    try: main()
    except Exception as e:
        reason=str(e) if isinstance(e,RuntimeError) and str(e).startswith('RESET_') else 'RESET_STAGE_FAILED'
        print(reason, file=sys.stderr)
        print('Retry this same release. Keep both old archives and new journals; never remove a pending transaction.', file=sys.stderr)
        sys.exit(1)

#!/usr/bin/env python3
"""Replace one explicitly identified Fast Testnet generation without migration.

This command is intentionally target-bound. It never accepts a remembered
address, never deletes financial state, and never reuses a prior deployment
journal. The old generation is archived before a new empty FastTestnetVault is
deployed on BNB Testnet (97).
"""
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time


BASE = Path('/var/lib/globaldroptrade')
SESSION = BASE/'fresh-fast-reset-20261107'
REPO = Path(__file__).resolve().parent.parent
ROOT_UID = 0
NAMES = ('fresh-fast-testnet-v1', 'fresh-fast-testnet-automation-v1')
PROFILE = 'global-fresh-fast-test-v1'
ADDRESS = re.compile(r'^0x[0-9a-fA-F]{40}$')
REVISION = re.compile(r'^[0-9a-f]{40}$')
PHASES = frozenset(('archiving', 'archived', 'deployed', 'connected', 'automated', 'complete'))
TIMER_UNITS = (
    'globaldroptrade-smart-worker.timer',
    'globaldroptrade-rpc-failover.timer',
    'globaldroptrade-position-index.timer',
    'globaldroptrade-zero-daily.timer',
    'globaldroptrade-automation.timer',
    'globaldroptrade-oracles.timer',
)
SERVICE_UNITS = (
    'globaldroptrade-smart-worker.service',
    'globaldroptrade-rpc-failover.service',
    'globaldroptrade-position-index.service',
    'globaldroptrade-zero-daily.service',
    'globaldroptrade-automation.service',
    'globaldroptrade-oracles.service',
    'globaldroptrade-migration.service',
    'globaldroptrade-fresh-rewards.service',
)
OPTIONAL_JOURNALS = (
    'automation-v1',
    'oracle-maintenance-v1',
    'fresh-zero-automation-v1',
    'zero-oracle-repair-v1',
)


def fail(code):
    raise RuntimeError(code)


def require(condition, code):
    if not condition:
        fail(code)


def canonical_address(value, code):
    require(isinstance(value, str) and ADDRESS.fullmatch(value) is not None, code)
    return value.lower()


def private(path, directory=False):
    try:
        info = Path(path).lstat()
    except FileNotFoundError:
        fail('RESET_PRIVATE_INPUT_REQUIRED')
    expected = stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)
    require(expected and info.st_uid == ROOT_UID and not info.st_mode & 0o077,
            'RESET_PRIVATE_INPUT_REQUIRED')


def read_private_bytes(path, maximum=16 * 1024 * 1024):
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except (FileNotFoundError, OSError):
        fail('RESET_PRIVATE_INPUT_REQUIRED')
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == ROOT_UID and
                not info.st_mode & 0o077 and info.st_size <= maximum,
                'RESET_PRIVATE_INPUT_REQUIRED')
        data = stream.read(maximum + 1)
    require(len(data) <= maximum, 'RESET_PRIVATE_INPUT_REQUIRED')
    return data


def digest(path):
    return hashlib.sha256(read_private_bytes(path)).hexdigest()


def read_private_json(path, code='RESET_PRIVATE_JSON_REQUIRED'):
    try:
        value = json.loads(read_private_bytes(path).decode('utf-8'))
    except (UnicodeDecodeError, ValueError):
        fail(code)
    require(isinstance(value, dict), code)
    return value


def save_json(path, value):
    path = Path(path)
    private(path.parent, directory=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.' + path.name + '-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(value, stream, separators=(',', ':'))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def copy_private_once(source, target):
    source, target = Path(source), Path(target)
    data = read_private_bytes(source)
    private(target.parent, directory=True)
    source_hash = hashlib.sha256(data).hexdigest()
    if target.exists():
        require(digest(target) == source_hash, 'RESET_ARCHIVE_ENVIRONMENT_CHANGED')
        return source_hash
    try:
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except OSError:
        fail('RESET_ARCHIVE_ENVIRONMENT_WRITE_FAILED')
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    return source_hash


def settled(path):
    """Reject every journal that could still broadcast a prior signed action."""
    path = Path(path)
    if not path.exists():
        return None
    journal = read_private_json(path, 'RESET_JOURNAL_REVIEW_REQUIRED')
    transactions = journal.get('transactions')
    require(isinstance(transactions, dict), 'RESET_JOURNAL_REVIEW_REQUIRED')
    oracle = journal.get('oracle', {})
    require(isinstance(oracle, dict), 'RESET_JOURNAL_REVIEW_REQUIRED')
    require(not journal.get('pending') and not oracle.get('pending'),
            'RESET_PENDING_TRANSACTION_RESUME_OLD_WORKER_FIRST')
    for value in transactions.values():
        require(isinstance(value, dict) and type(value.get('block')) is int and value['block'] >= 1,
                'RESET_PENDING_TRANSACTION_RESUME_OLD_WORKER_FIRST')
    return digest(path)


def parse_private_environment(path):
    raw = read_private_bytes(path, 1024 * 1024)
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError:
        fail('RESET_ACTIVE_TESTNET_ENVIRONMENT_REQUIRED')
    values = {}
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue
        match = re.fullmatch(r'(?:export[ \t]+)?([A-Z][A-Z0-9_]*)=(.*)', stripped)
        if not match:
            continue
        value = match.group(2).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('\"', "'"):
            value = value[1:-1]
        values[match.group(1)] = value
    return values


def check_active_environment(expected):
    values = parse_private_environment('/etc/globaldroptrade/trades.env')
    require(values.get('TRADES_CHAIN_ID') == '97' and values.get('TRADES_ZERO_START_PROFILE') == PROFILE,
            'RESET_ACTIVE_FAST_TESTNET_REQUIRED')
    require(canonical_address(values.get('TRADES_VAULT_ADDRESS'),
                              'RESET_ACTIVE_TARGET_REQUIRED') == expected,
            'RESET_ACTIVE_TARGET_REQUIRED')
    require(bool(values.get('TRADES_RPC_URL')), 'RESET_TESTNET_RPC_REQUIRED')


def check_testnet_rpc(expected):
    program = r"""
import fs from 'node:fs';
import {parseEnv} from 'node:util';
import {FetchRequest, JsonRpcProvider} from 'ethers';
let provider;
try {
  const expected = process.argv[1].toLowerCase();
  const settings = parseEnv(fs.readFileSync('/etc/globaldroptrade/trades.env', 'utf8'));
  if (settings.TRADES_CHAIN_ID !== '97' ||
      settings.TRADES_ZERO_START_PROFILE !== 'global-fresh-fast-test-v1' ||
      String(settings.TRADES_VAULT_ADDRESS || '').toLowerCase() !== expected ||
      !settings.TRADES_RPC_URL) throw Error('invalid');
  const request = new FetchRequest(settings.TRADES_RPC_URL);
  request.timeout = 15000;
  provider = new JsonRpcProvider(request, 97, {staticNetwork:true, batchMaxCount:1, cacheTimeout:-1});
  if (Number(await provider.send('eth_chainId', [])) !== 97 || !await provider.getBlock('latest')) throw Error('invalid');
  console.log('RESET_TESTNET_RPC_PREFLIGHT_VALID');
} catch {
  console.error('RESET_TESTNET_RPC_REQUIRED');
  process.exitCode = 1;
} finally {
  provider?.destroy();
}
"""
    run('node', '--input-type=module', '-e', program, expected)


def check_old_target_on_chain(expected):
    # This is read-only and verifies creation, runtime, queue, owner, reporter,
    # feeds and current Fast Testnet markers before any state is moved.
    output = run_output('node', '--env-file=/etc/globaldroptrade/trades.env',
                        'scripts/zero-start-automation.mjs', '--oracles-only', '--check', '--fast-testnet')
    require(('target=' + expected) in output.lower(), 'RESET_CANONICAL_TARGET_MISMATCH')


def checked_source_revision():
    environment = {**os.environ, 'GIT_OPTIONAL_LOCKS': '0'}
    try:
        revision = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=REPO, env=environment,
                                  stdin=subprocess.DEVNULL, capture_output=True, text=True,
                                  timeout=30, check=True).stdout.strip()
        clean = subprocess.run(['git', 'diff', '--quiet'], cwd=REPO, env=environment,
                               stdin=subprocess.DEVNULL, timeout=30, check=False).returncode
    except (OSError, subprocess.SubprocessError):
        fail('RESET_SOURCE_REVISION_REQUIRED')
    require(REVISION.fullmatch(revision) is not None and clean == 0,
            'RESET_SOURCE_REVISION_REQUIRED')
    return revision


def active_reports(base, expected):
    deploy = read_private_json(base/NAMES[0]/'deployment-public.json')
    connection = read_private_json(base/NAMES[0]/'connection-public.json')
    policy = read_private_json(base/NAMES[1]/'daily-policy.json')
    require(deploy.get('chainId') == 97 and deploy.get('releaseId') == PROFILE and
            deploy.get('testMode') is True and deploy.get('initialServerReporter') is True and
            deploy.get('fastTestnetVersion') == 1 and deploy.get('verified') is True and
            canonical_address(deploy.get('contractAddress'), 'RESET_OLD_DEPLOYMENT_MISMATCH') == expected,
            'RESET_OLD_DEPLOYMENT_MISMATCH')
    require(connection.get('chainId') == 97 and connection.get('releaseId') == PROFILE and
            connection.get('testMode') is True and connection.get('initialServerReporter') is True and
            connection.get('fastTestnetVersion') == 1 and connection.get('verified') is True and
            connection.get('siteConnected') is True and
            canonical_address(connection.get('target'), 'RESET_OLD_CONNECTION_MISMATCH') == expected and
            canonical_address(connection.get('contractAddress'), 'RESET_OLD_CONNECTION_MISMATCH') == expected,
            'RESET_OLD_CONNECTION_MISMATCH')
    require(policy.get('chainId') == 97 and policy.get('releaseId') == PROFILE and
            policy.get('testMode') is True and policy.get('fastTestnetVersion') == 1 and
            policy.get('periodSeconds') in (900, 3600) and
            canonical_address(policy.get('vaultAddress'), 'RESET_OLD_POLICY_MISMATCH') == expected,
            'RESET_OLD_POLICY_MISMATCH')
    return {'deployment': digest(base/NAMES[0]/'deployment-public.json'),
            'connection': digest(base/NAMES[0]/'connection-public.json'),
            'policy': digest(base/NAMES[1]/'daily-policy.json')}


def optional_journal_manifest(base):
    entries = []
    for name in OPTIONAL_JOURNALS:
        directory = base/name
        if not directory.exists():
            continue
        private(directory, directory=True)
        journal_hash = settled(directory/'journal.json')
        if journal_hash:
            entries.append({'path': name + '/journal.json', 'sha256': journal_hash})
    return entries


def plan_archive(base, session, expected, revision, environment_hash):
    """Freeze the exact old generation before a single file is moved."""
    report_hashes = active_reports(base, expected)
    external_journals = optional_journal_manifest(base)
    files, preserved = [], []
    for name in NAMES:
        root = base/name
        private(root, directory=True)
        settled(root/'journal.json')
        for entry in sorted(root.iterdir(), key=lambda item: item.name):
            info = entry.lstat()
            if stat.S_ISDIR(info.st_mode):
                private(entry, directory=True)
                if name == NAMES[1] and re.fullmatch(r'install-[0-9]{8}T[0-9]{6}-[0-9]+', entry.name):
                    preserved.append(name + '/' + entry.name)
                    continue
                fail('RESET_UNEXPECTED_STATE_DIRECTORY')
            if entry.name.endswith('.lock'):
                private(entry)
                continue
            private(entry)
            files.append({'path': name + '/' + entry.name, 'sha256': digest(entry)})
    state = {
        'version': 2,
        'kind': 'fresh-fast-testnet-reset',
        'sourceRevision': revision,
        'oldTarget': expected,
        'profile': PROFILE,
        'chainId': 97,
        'phase': 'archiving',
        'environmentSha256': environment_hash,
        'reportHashes': report_hashes,
        'externalSettledJournals': external_journals,
        'files': files,
        'preservedInstallerBackups': preserved,
    }
    save_json(session/'session.json', state)
    return state


def validate_session(value, expected, revision):
    require(value.get('version') == 2 and value.get('kind') == 'fresh-fast-testnet-reset' and
            value.get('sourceRevision') == revision and value.get('oldTarget') == expected and
            value.get('profile') == PROFILE and value.get('chainId') == 97 and
            value.get('phase') in PHASES and isinstance(value.get('files'), list) and
            isinstance(value.get('environmentSha256'), str) and
            re.fullmatch(r'[0-9a-f]{64}', value['environmentSha256']) is not None,
            'RESET_SESSION_IDENTITY_MISMATCH')


def archive(base, session, state):
    for row in state['files']:
        require(isinstance(row, dict) and isinstance(row.get('path'), str) and
                isinstance(row.get('sha256'), str) and re.fullmatch(r'[0-9a-f]{64}', row['sha256']) is not None,
                'RESET_ARCHIVE_MANIFEST_INVALID')
        relative = Path(row['path'])
        require(len(relative.parts) == 2 and relative.parts[0] in NAMES and
                not relative.name.endswith('.lock'), 'RESET_ARCHIVE_MANIFEST_INVALID')
        source = base/relative
        target = session/'previous-state'/relative
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        private(target.parent, directory=True)
        if target.exists():
            require(digest(target) == row['sha256'] and not source.exists(), 'RESET_ARCHIVE_CONFLICT')
            continue
        require(source.exists() and digest(source) == row['sha256'], 'RESET_ARCHIVE_INPUT_CHANGED')
        os.rename(source, target)
    state['phase'] = 'archived'
    save_json(session/'session.json', state)


@contextlib.contextmanager
def locks(paths):
    descriptors = []
    try:
        for path in paths:
            path = Path(path)
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            private(path.parent, directory=True)
            descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            info = os.fstat(descriptor)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != ROOT_UID or info.st_mode & 0o077:
                os.close(descriptor)
                fail('RESET_PRIVATE_LOCK_REQUIRED')
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            descriptors.append(descriptor)
        yield
    finally:
        for descriptor in reversed(descriptors):
            os.close(descriptor)


def reset_locks():
    paths = [
        BASE/'fast-testnet-setup-v1/setup.lock',
        BASE/'zero-oracle-repair-v1/setup.lock',
        BASE/'fresh-fast-testnet-connection/run.lock',
        BASE/'worker-sync-v1/run.lock',
        BASE/'smart-worker-v1/run.lock',
        BASE/'rpc-failover-v1/install.lock',
    ]
    paths.extend(BASE/name/lock for name in NAMES for lock in ('setup.lock', 'run.lock'))
    return paths


def run(*arguments):
    subprocess.run(arguments, cwd=REPO, stdin=subprocess.DEVNULL, check=True)


def run_output(*arguments):
    result = subprocess.run(arguments, cwd=REPO, stdin=subprocess.DEVNULL,
                            capture_output=True, text=True, check=True)
    if result.stdout:
        print(result.stdout, end='' if result.stdout.endswith('\n') else '\n', flush=True)
    if result.stderr:
        print(result.stderr, file=sys.stderr, end='' if result.stderr.endswith('\n') else '\n', flush=True)
    return result.stdout


def unit_info(unit):
    load = subprocess.run(['systemctl', 'show', '--property=LoadState', '--value', unit],
                          stdin=subprocess.DEVNULL, capture_output=True, text=True, check=False)
    active = subprocess.run(['systemctl', 'show', '--property=ActiveState', '--value', unit],
                            stdin=subprocess.DEVNULL, capture_output=True, text=True, check=False)
    require(load.returncode == 0 and active.returncode == 0, 'RESET_SYSTEMD_INSPECTION_REQUIRED')
    return load.stdout.strip(), active.stdout.strip()


def quiesce():
    """Stop schedulers, then wait; never terminate a possible signing service."""
    for timer in TIMER_UNITS:
        loaded, active = unit_info(timer)
        if loaded == 'not-found':
            require(active in ('', 'inactive', 'failed'), 'RESET_UNMANAGED_TIMER_ACTIVE')
            continue
        require(loaded == 'loaded' and active in ('active', 'activating', 'inactive', 'failed'),
                'RESET_SYSTEMD_INSPECTION_REQUIRED')
        run('systemctl', 'stop', timer)
    for attempt in range(181):
        busy = []
        for service in SERVICE_UNITS:
            loaded, active = unit_info(service)
            if loaded == 'not-found':
                require(active in ('', 'inactive', 'failed'), 'RESET_UNMANAGED_SIGNER_ACTIVE')
                continue
            require(loaded == 'loaded', 'RESET_SYSTEMD_INSPECTION_REQUIRED')
            if active in ('inactive', 'failed'):
                continue
            require(active in ('active', 'activating', 'deactivating', 'reloading'),
                    'RESET_SYSTEMD_INSPECTION_REQUIRED')
            busy.append(service)
        if not busy:
            return
        if attempt == 180:
            fail('RESET_SIGNER_WORKER_BUSY_RETRY_SAME_COMMAND')
        if attempt % 30 == 0:
            print('RESET_WAITING_FOR_SIGNER_WORKER', flush=True)
        time.sleep(1)


def disable_prior_smart_scheduler():
    """Avoid handing a fresh target to the old ordered-scheduler release."""
    loaded, active = unit_info('globaldroptrade-smart-worker.timer')
    if loaded == 'not-found':
        require(active in ('', 'inactive', 'failed'), 'RESET_UNMANAGED_TIMER_ACTIVE')
        return
    require(loaded == 'loaded' and active in ('inactive', 'failed'),
            'RESET_SMART_SCHEDULER_QUIESCENCE_REQUIRED')
    run('systemctl', 'disable', '--now', 'globaldroptrade-smart-worker.timer')
    _, active = unit_info('globaldroptrade-smart-worker.timer')
    require(active in ('inactive', 'failed'), 'RESET_SMART_SCHEDULER_QUIESCENCE_REQUIRED')


def verify_new_deployment(base, old_target):
    report = read_private_json(base/NAMES[0]/'deployment-public.json')
    target = canonical_address(report.get('contractAddress'), 'RESET_NEW_DEPLOYMENT_REQUIRED')
    require(target != old_target and report.get('chainId') == 97 and report.get('releaseId') == PROFILE and
            report.get('testMode') is True and report.get('initialServerReporter') is True and
            report.get('fastTestnetVersion') == 1 and report.get('verified') is True and
            report.get('emptyAtDeployment') is True and report.get('accountsMigrated') is False and
            canonical_address(report.get('queue'), 'RESET_NEW_QUEUE_REQUIRED') != '0x' + '0' * 40,
            'RESET_NEW_DEPLOYMENT_REQUIRED')
    return target


def verify_new_connection(base, target):
    report = read_private_json(base/NAMES[0]/'connection-public.json')
    require(report.get('chainId') == 97 and report.get('releaseId') == PROFILE and
            report.get('testMode') is True and report.get('initialServerReporter') is True and
            report.get('fastTestnetVersion') == 1 and report.get('verified') is True and
            report.get('siteConnected') is True and report.get('accountsMigrated') is False and
            canonical_address(report.get('target'), 'RESET_NEW_CONNECTION_REQUIRED') == target and
            canonical_address(report.get('contractAddress'), 'RESET_NEW_CONNECTION_REQUIRED') == target,
            'RESET_NEW_CONNECTION_REQUIRED')


def verify_new_policy(base, target):
    policy = read_private_json(base/NAMES[1]/'daily-policy.json')
    require(policy.get('chainId') == 97 and policy.get('releaseId') == PROFILE and
            policy.get('testMode') is True and policy.get('fastTestnetVersion') == 1 and
            policy.get('periodSeconds') in (900, 3600) and
            policy.get('basis') == 'position-anniversary-principal' and
            policy.get('positionScheduleVersion') == 1 and
            canonical_address(policy.get('vaultAddress'), 'RESET_NEW_POLICY_REQUIRED') == target,
            'RESET_NEW_POLICY_REQUIRED')


def verify_smart_scheduler():
    loaded, active = unit_info('globaldroptrade-smart-worker.timer')
    require(loaded == 'loaded' and active == 'active', 'RESET_SMART_SCHEDULER_REQUIRED')
    loaded, active = unit_info('globaldroptrade-rpc-failover.timer')
    require(loaded == 'loaded' and active == 'active', 'RESET_RPC_FAILOVER_SCHEDULER_REQUIRED')
    for timer in ('globaldroptrade-position-index.timer', 'globaldroptrade-zero-daily.timer'):
        loaded, active = unit_info(timer)
        require(loaded == 'loaded' and active in ('inactive', 'failed'),
                'RESET_MULTIPLE_DAILY_SCHEDULERS_ACTIVE')


def final_readiness(target):
    output = run_output('node', '--env-file=/etc/globaldroptrade/trades.env',
                        'scripts/zero-start-automation.mjs', '--check', '--fast-testnet', '--hourly-test')
    require('ZERO_START_AUTOMATION_CHECKED ready=true' in output and 'BLOCKERS=none' in output,
            'RESET_AUTOMATION_READINESS_WAITING')
    print('RESET_AUTOMATION_READINESS_VALID target=' + target, flush=True)


def parse_args():
    if len(sys.argv) != 4 or sys.argv[1] != '--execute' or sys.argv[2] != '--expected-target':
        fail('RESET_EXPLICIT_TARGET_AND_EXECUTE_REQUIRED')
    return canonical_address(sys.argv[3], 'RESET_EXPECTED_TARGET_REQUIRED')


def main():
    expected = parse_args()
    require(os.geteuid() == 0, 'RESET_ROOT_EXPLICIT_EXECUTE_REQUIRED')
    os.umask(0o077)
    SESSION.mkdir(parents=True, exist_ok=True, mode=0o700)
    private(SESSION, directory=True)
    revision = checked_source_revision()
    with locks((SESSION/'run.lock',)):
        session_file = SESSION/'session.json'
        state = read_private_json(session_file) if session_file.exists() else None
        if state is not None:
            validate_session(state, expected, revision)
            if state['phase'] == 'complete':
                print('RESET_ALREADY_COMPLETE target=' + state['newTarget'])
                return
        if state is None or state['phase'] == 'archiving':
            check_active_environment(expected)
            check_testnet_rpc(expected)
            check_old_target_on_chain(expected)
            quiesce()
            disable_prior_smart_scheduler()
            with locks(reset_locks()):
                # A worker that completed while quiescing may have changed its journal.
                check_active_environment(expected)
                if state is None:
                    environment_hash = copy_private_once('/etc/globaldroptrade/trades.env', SESSION/'trades.env')
                    state = plan_archive(BASE, SESSION, expected, revision, environment_hash)
                archive(BASE, SESSION, state)
            print('RESET_OLD_STATE_ARCHIVED backup=' + str(SESSION), flush=True)
        if state['phase'] == 'archived':
            run('bash', 'ubuntu-deploy-zero-start.sh', '--execute', '--fast-testnet')
            target = verify_new_deployment(BASE, expected)
            state.update(phase='deployed', newTarget=target)
            save_json(session_file, state)
        if state['phase'] == 'deployed':
            run('bash', 'ubuntu-connect-zero-start.sh', '--fast-testnet')
            verify_new_connection(BASE, state['newTarget'])
            state['phase'] = 'connected'
            save_json(session_file, state)
        if state['phase'] == 'connected':
            # The normal Fast Testnet seed is retained. A one-million Test USDT
            # top-up is a separate, explicit operator decision.
            run('bash', 'ubuntu-zero-oracle.sh', '--execute', '--hourly-test')
            run('bash', 'ubuntu-position-hourly.sh', '--execute', '--expected-target', state['newTarget'])
            verify_new_policy(BASE, state['newTarget'])
            run('bash', 'ubuntu-split-hourly-worker.sh', '--execute')
            run('bash', 'ubuntu-smart-worker.sh', '--execute')
            verify_smart_scheduler()
            state['phase'] = 'automated'
            save_json(session_file, state)
        if state['phase'] == 'automated':
            final_readiness(state['newTarget'])
            state['phase'] = 'complete'
            save_json(session_file, state)
        print('RESET_COMPLETE target=' + state['newTarget'])
        print('CHAIN_ID=97 OLD_ACCOUNTS_MIGRATED=false HOURLY_TEST=true')
        print('TEST_REWARD_TOPUP=MINIMAL_SEED_ONLY NO_MILLION_TOPUP=true')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        message = str(error)
        code = message if re.fullmatch(r'RESET_[A-Z0-9_]+', message or '') else 'RESET_STAGE_FAILED'
        print(code, file=sys.stderr)
        print('Retry the same checked-out release. Preserve the session archive and every journal; never remove pending state.',
              file=sys.stderr)
        raise SystemExit(1)

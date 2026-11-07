#!/usr/bin/env python3
"""Offline tests for the target-bound fresh Fast Testnet reset."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile


spec = importlib.util.spec_from_file_location(
    'reset', Path(__file__).with_name('reset-fresh-fast-testnet-20261107.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
m.ROOT_UID = os.getuid()


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.write_text(json.dumps(value), encoding='utf-8')
    path.chmod(0o600)


def fixture(root, target):
    base = root/'state'
    session = base/'reset'
    session.mkdir(parents=True, mode=0o700)
    for name in m.NAMES:
        write(base/name/'journal.json', {'transactions': {'old': {'block': 1, 'raw': 'confirmed'}}})
        write(base/name/'run.lock', {})
    write(base/m.NAMES[0]/'deployment-public.json', {
        'chainId': 97, 'releaseId': m.PROFILE, 'testMode': True,
        'initialServerReporter': True, 'fastTestnetVersion': 1, 'verified': True,
        'contractAddress': target,
    })
    write(base/m.NAMES[0]/'connection-public.json', {
        'chainId': 97, 'releaseId': m.PROFILE, 'testMode': True,
        'initialServerReporter': True, 'fastTestnetVersion': 1, 'verified': True,
        'siteConnected': True, 'target': target, 'contractAddress': target,
    })
    write(base/m.NAMES[1]/'daily-policy.json', {
        'chainId': 97, 'releaseId': m.PROFILE, 'testMode': True,
        'fastTestnetVersion': 1, 'periodSeconds': 900, 'vaultAddress': target,
    })
    return base, session


old = '0x' + 'ab' * 20
revision = '1' * 40
with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    base, session = fixture(root, old)
    lock_inode = (base/m.NAMES[0]/'run.lock').stat().st_ino
    environment = root/'trades.env'
    write(environment, {'private': 'environment'})
    state = m.plan_archive(base, session, old, revision, m.digest(environment))
    first = state['files'][0]
    source = base/first['path']
    destination = session/'previous-state'/first['path']
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.rename(source, destination)
    m.archive(base, session, state)
    assert state['phase'] == 'archived'
    assert (base/m.NAMES[0]/'run.lock').stat().st_ino == lock_inode
    assert (session/'previous-state'/m.NAMES[0]/'journal.json').exists()
    m.archive(base, session, state)

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    base, session = fixture(root, old)
    for kind in ({'transactions': {'p': {'raw': 'pending'}}},
                 {'pending': {'id': 1}, 'transactions': {}},
                 {'oracle': {'pending': {'id': 1}}, 'transactions': {}}):
        pending = root/'pending.json'
        write(pending, kind)
        try:
            m.settled(pending)
            raise AssertionError('pending transaction accepted')
        except RuntimeError:
            pass
    bad_policy = base/m.NAMES[1]/'daily-policy.json'
    value = json.loads(bad_policy.read_text())
    value['chainId'] = 56
    write(bad_policy, value)
    try:
        m.plan_archive(base, session, old, revision, '0' * 64)
        raise AssertionError('mainnet policy accepted')
    except RuntimeError:
        pass
    assert (base/m.NAMES[0]/'journal.json').exists()
    assert not (session/'session.json').exists()

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    base, session = fixture(root, old)
    bad_deployment = base/m.NAMES[0]/'deployment-public.json'
    value = json.loads(bad_deployment.read_text())
    value['releaseId'] = 'untrusted-profile'
    write(bad_deployment, value)
    try:
        m.plan_archive(base, session, old, revision, '0' * 64)
        raise AssertionError('wrong profile accepted')
    except RuntimeError:
        pass
    assert not (session/'session.json').exists()

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    base, session = fixture(root, old)
    original_systemd = m.SYSTEMD_ROOT
    m.SYSTEMD_ROOT = root/'etc/systemd/system'
    override = m.SYSTEMD_ROOT/'globaldroptrade-zero-daily.service.d/split-index.conf'
    status = base/'rpc-failover-v1/status.json'
    write(override, {'old': 'split-index-override'})
    write(status, {'status': 'apply-in-progress'})
    state = m.plan_archive(base, session, old, revision, '0' * 64)
    m.archive_retired_control_state(base, session, state)
    assert not override.exists() and not status.exists()
    assert (session/'previous-control-state/systemd/zero-daily-split-index.conf').exists()
    assert (session/'previous-control-state/rpc-failover-v1/status.json').exists()
    assert set(state['retiredControlState']) == {'splitDailyOverride', 'rpcFailoverStatus'}
    m.archive_retired_control_state(base, session, state)
    m.SYSTEMD_ROOT = original_systemd

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    base, session = fixture(root, old)
    state = m.plan_archive(base, session, old, revision, '0' * 64)
    row = next(item for item in state['files'] if item['path'].endswith('connection-public.json'))
    source = base/row['path']
    target = session/'previous-state'/row['path']
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.rename(source, target)
    assert m.archive_started(base, session, state) is True
    m.archive(base, session, state)
    assert state['phase'] == 'archived'

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    base, session = fixture(root, old)
    backup = base/m.NAMES[1]/'install-20261107T042200-1'
    write(backup/'journal.json', {'transactions': {'historical': {'block': 1}}})
    inode = backup.stat().st_ino
    state = m.plan_archive(base, session, old, revision, '0' * 64)
    assert state['preservedInstallerBackups'] == [m.NAMES[1] + '/' + backup.name]
    m.archive(base, session, state)
    assert backup.stat().st_ino == inode
    assert (backup/'journal.json').exists()
    assert (session/'previous-state'/m.NAMES[1]/'journal.json').exists()

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    base, session = fixture(root, old)
    try:
        m.plan_archive(base, session, '0x' + 'cd' * 20, revision, '0' * 64)
        raise AssertionError('different target accepted')
    except RuntimeError:
        pass
    assert not (session/'session.json').exists()


def assert_target(actual, expected):
    assert actual == expected


calls = []
m.run = lambda *args: calls.append(args)
m.unit_info = lambda unit: ('loaded', 'active' if unit.endswith('.timer') else 'inactive')
m.quiesce()
assert calls == [('systemctl', 'stop', unit) for unit in m.TIMER_UNITS]
assert not any(args[-1].endswith('.service') for args in calls)

states = [
    ('loaded', 'inactive'),
    ('loaded', 'inactive'),
]
m.unit_info = lambda unit: states.pop(0)
m.run = lambda *args: calls.append(args)
m.disable_prior_smart_scheduler()
assert calls[-1] == ('systemctl', 'disable', '--now', 'globaldroptrade-smart-worker.timer')

old_output = m.run_output
m.run_output = lambda *args: 'ZERO_START_ORACLES_CHECKED ready=true target=' + old
m.check_old_target_on_chain(old)
m.run_output = lambda *args: 'ZERO_START_ORACLES_CHECKED ready=true target=0x' + 'cd' * 20
try:
    m.check_old_target_on_chain(old)
    raise AssertionError('canonical target mismatch accepted')
except RuntimeError:
    pass
m.run_output = old_output


# Exercise the resumable lifecycle with mocked commands. The fake deployment
# writes a new journal and report; a second invocation must resume it rather
# than archive it or create another contract.
with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    base, session = fixture(root, old)
    new = '0x' + '12' * 20
    calls = []
    original_systemd = m.SYSTEMD_ROOT
    m.SYSTEMD_ROOT = root/'etc/systemd/system'
    override = m.SYSTEMD_ROOT/'globaldroptrade-zero-daily.service.d/split-index.conf'
    failover_status = base/'rpc-failover-v1/status.json'
    write(override, {'old': 'split-index-override'})
    write(failover_status, {'status': 'apply-failed'})
    staged = m.plan_archive(base, session, old, revision, '0' * 64)
    moved = next(item for item in staged['files'] if item['path'].endswith('connection-public.json'))
    moved_target = session/'previous-state'/moved['path']
    moved_target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.rename(base/moved['path'], moved_target)
    m.BASE, m.SESSION = base, session
    m.os.geteuid = lambda: 0
    m.checked_source_revision = lambda: revision
    m.check_active_environment = lambda target: assert_target(target, old)
    m.check_testnet_rpc = lambda target: assert_target(target, old)
    m.check_old_target_on_chain = lambda target: (_ for _ in ()).throw(
        AssertionError('canonical verification must not reopen a partially archived report'))
    m.quiesce = lambda: None
    m.disable_prior_smart_scheduler = lambda: None
    m.reset_locks = lambda: ()
    m.copy_private_once = lambda source, target: '0' * 64
    m.final_readiness = lambda target: assert_target(target, new)
    m.verify_smart_scheduler = lambda: None

    def fake_run(*args):
        calls.append(args)
        if args[1] == 'ubuntu-deploy-zero-start.sh':
            write(base/m.NAMES[0]/'journal.json', {'transactions': {'new': {'block': 2}}})
            write(base/m.NAMES[0]/'deployment-public.json', {
                'chainId': 97, 'releaseId': m.PROFILE, 'testMode': True,
                'initialServerReporter': True, 'fastTestnetVersion': 1, 'verified': True,
                'contractAddress': new, 'queue': '0x' + '34' * 20,
                'emptyAtDeployment': True, 'accountsMigrated': False,
            })
        elif args[1] == 'ubuntu-connect-zero-start.sh':
            write(base/m.NAMES[0]/'connection-public.json', {
                'chainId': 97, 'releaseId': m.PROFILE, 'testMode': True,
                'initialServerReporter': True, 'fastTestnetVersion': 1, 'verified': True,
                'siteConnected': True, 'accountsMigrated': False,
                'target': new, 'contractAddress': new,
            })
        elif args[1] == 'ubuntu-position-hourly.sh':
            assert args[-1] == new
            write(base/m.NAMES[1]/'daily-policy.json', {
                'chainId': 97, 'releaseId': m.PROFILE, 'testMode': True,
                'fastTestnetVersion': 1, 'periodSeconds': 3600,
                'vaultAddress': new, 'basis': 'position-anniversary-principal',
                'positionScheduleVersion': 1,
            })
        elif args[1] == 'ubuntu-zero-oracle.sh':
            assert not override.exists()
            assert not failover_status.exists()

    m.run = fake_run
    m.sys.argv = ['reset', '--execute', '--expected-target', old]
    m.main()
    completed_calls = len(calls)
    m.main()
    assert len(calls) == completed_calls
    saved = json.loads((session/'session.json').read_text())
    assert saved['phase'] == 'complete' and saved['newTarget'] == new
    assert (session/'previous-state'/m.NAMES[0]/'journal.json').exists()
    assert not any('--fund-test-million' in call for call in calls)
    assert ('bash', 'ubuntu-split-hourly-worker.sh', '--execute') in calls
    assert ('bash', 'ubuntu-smart-worker.sh', '--execute') in calls
    assert (session/'previous-control-state/systemd/zero-daily-split-index.conf').exists()
    assert (session/'previous-control-state/rpc-failover-v1/status.json').exists()
    m.SYSTEMD_ROOT = original_systemd

assert '0xB5c3C0f8fc30b2FDB8b16d2325127dAe7C8DCD5B' not in Path(m.__file__).read_text()
print('RESET_FRESH_FAST_TESTNET_20261107_OFFLINE_TESTS_PASSED: explicit target binding, chain guard, pending guard, immutable archive, preserved locks, installer backup preservation and resumable empty deployment')

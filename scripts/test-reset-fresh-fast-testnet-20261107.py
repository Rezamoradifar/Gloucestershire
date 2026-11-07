#!/usr/bin/env python3
"""Offline tests for the target-bound fresh Fast Testnet reset."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
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


def write_text(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.write_text(value, encoding='utf-8')
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
    external = base/'automation-v1/journal.json'
    write(external, {'transactions': {'old': {'block': 1}}})
    state = m.plan_archive(base, session, old, revision, '0' * 64)
    write(external, {'transactions': {'changed': {'block': 2}}})
    try:
        m.archive_external_journals(base, session, state)
        raise AssertionError('changed external journal accepted')
    except RuntimeError:
        pass
    assert external.exists()
    write(external, {'transactions': {'pending': {'raw': 'must-not-move'}}})
    try:
        m.archive_external_journals(base, session, state)
        raise AssertionError('pending external journal accepted')
    except RuntimeError:
        pass
    assert external.exists()

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    base, session = fixture(root, old)
    external = base/'automation-v1/journal.json'
    write(external, {'transactions': {'old': {'block': 1}}})
    state = m.plan_archive(base, session, old, revision, '0' * 64)
    m.archive_external_journals(base, session, state)
    assert m.external_archive_started(base, session, state) is True
    assert (session/'previous-state/automation-v1/journal.json').exists()
    write(external, {'transactions': {'recreated': {'block': 2}}})
    try:
        m.archive_external_journals(base, session, state)
        raise AssertionError('recreated external journal accepted')
    except RuntimeError:
        pass

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
    original_config_root, original_env_file, original_api_state_root = m.CONFIG_ROOT, m.ENV_FILE, m.API_STATE_ROOT
    original_api_state_uid = m.api_state_uid
    m.SYSTEMD_ROOT = root/'etc/systemd/system'
    m.CONFIG_ROOT = root/'etc/globaldroptrade'
    m.ENV_FILE = m.CONFIG_ROOT/'trades.env'
    m.API_STATE_ROOT = root/'var/lib/globaldroptrade-api'
    m.api_state_uid = lambda: os.getuid()
    override = m.SYSTEMD_ROOT/'globaldroptrade-zero-daily.service.d/split-index.conf'
    reliability_override = m.SYSTEMD_ROOT/'globaldroptrade-zero-daily.service.d/zz-daily-reliability.conf'
    timer_override = m.SYSTEMD_ROOT/'globaldroptrade-zero-daily.timer.d/split-index.conf'
    activity_policy = m.CONFIG_ROOT/'daily-activity-policy.json'
    activity_history = m.API_STATE_ROOT/'daily-activity.json'
    status = base/'rpc-failover-v1/status.json'
    write_text(m.ENV_FILE, "TRADES_CHAIN_ID='97'\nTRADES_VAULT_ADDRESS='" + old + "'\nDAILY_ACTIVITY_FILE='/var/lib/globaldroptrade-api/daily-activity.json'\nDAILY_ACTIVITY_ACTIVATION_TIMESTAMP='1'\nGLOBAL_DAILY_ACTIVITY_POLICY='/etc/globaldroptrade/daily-activity-policy.json'\n")
    write(override, {'old': 'split-index-override'})
    write(reliability_override, {'old': 'daily-reliability-override'})
    write(timer_override, {'old': 'split-index-timer-override'})
    write(activity_policy, {'old': 'daily-activity-policy'})
    write(activity_history, {'old': 'daily-activity-history'})
    write(status, {'status': 'apply-in-progress'})
    state = m.plan_archive(base, session, old, revision, m.digest(m.ENV_FILE))
    m.archive_retired_control_state(base, session, state)
    m.scrub_activity_environment(session, state)
    assert not override.exists() and not reliability_override.exists() and not timer_override.exists() and not activity_policy.exists() and not activity_history.exists() and not status.exists()
    assert (session/'previous-control-state/systemd/zero-daily-split-index.conf').exists()
    assert (session/'previous-control-state/systemd/zero-daily-zz-daily-reliability.conf').exists()
    assert (session/'previous-control-state/systemd/zero-daily-timer-split-index.conf').exists()
    assert (session/'previous-control-state/etc/globaldroptrade/daily-activity-policy.json').exists()
    assert (session/'previous-control-state/var/lib/globaldroptrade-api/daily-activity.json').exists()
    assert (session/'previous-control-state/rpc-failover-v1/status.json').exists()
    assert set(state['retiredControlState']) == {
        'splitDailyOverride', 'dailyReliabilityOverride', 'splitDailyTimerOverride',
        'dailyActivityPolicy', 'dailyActivityHistory', 'rpcFailoverStatus'}
    assert 'DAILY_ACTIVITY_' not in m.ENV_FILE.read_text()
    assert 'GLOBAL_DAILY_ACTIVITY_POLICY' not in m.ENV_FILE.read_text()
    assert state['activityEnvironmentReset']['removedKeys'] == [
        'DAILY_ACTIVITY_ACTIVATION_TIMESTAMP', 'DAILY_ACTIVITY_FILE', 'GLOBAL_DAILY_ACTIVITY_POLICY']
    m.archive_retired_control_state(base, session, state)
    m.scrub_activity_environment(session, state)
    m.SYSTEMD_ROOT = original_systemd
    m.CONFIG_ROOT, m.ENV_FILE, m.API_STATE_ROOT = original_config_root, original_env_file, original_api_state_root
    m.api_state_uid = original_api_state_uid

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    base, session = fixture(root, old)
    new = '0x' + '12' * 20
    original_config_root, original_env_file, original_api_state_root = m.CONFIG_ROOT, m.ENV_FILE, m.API_STATE_ROOT
    original_api_state_uid = m.api_state_uid
    m.CONFIG_ROOT = root/'etc/globaldroptrade'
    m.ENV_FILE = m.CONFIG_ROOT/'trades.env'
    m.API_STATE_ROOT = root/'var/lib/globaldroptrade-api'
    m.api_state_uid = lambda: os.getuid()
    write_text(m.ENV_FILE, "TRADES_CHAIN_ID='97'\nTRADES_ZERO_START_PROFILE='global-fresh-fast-test-v1'\nTRADES_VAULT_ADDRESS='" + old + "'\nTRADES_RPC_URL='https://example.invalid'\nDAILY_ACTIVITY_ACTIVATION_TIMESTAMP='1'\n")
    state = m.plan_archive(base, session, old, revision, m.digest(m.ENV_FILE))
    m.scrub_activity_environment(session, state)
    state.update(phase='deployed', newTarget=new)
    write_text(m.ENV_FILE, "TRADES_CHAIN_ID='97'\nTRADES_ZERO_START_PROFILE='global-fresh-fast-test-v1'\nTRADES_VAULT_ADDRESS='" + new + "'\nTRADES_RPC_URL='https://example.invalid'\nDAILY_ACTIVITY_ACTIVATION_TIMESTAMP='2'\n")
    policy = m.CONFIG_ROOT/'daily-activity-policy.json'
    history = m.API_STATE_ROOT/'daily-activity.json'
    write(policy, {'partial': 'connection-policy'})
    write(history, {'partial': 'connection-history'})
    m.recover_connection_activity_state(base, session, state)
    assert m.digest(m.ENV_FILE) == state['activityEnvironmentReset']['afterSha256']
    assert not policy.exists() and not history.exists()
    assert any((session/'connection-retry-state/environment').iterdir())
    assert any((session/'connection-retry-state/dailyActivityPolicy').iterdir())
    assert any((session/'connection-retry-state/dailyActivityHistory').iterdir())
    m.CONFIG_ROOT, m.ENV_FILE, m.API_STATE_ROOT = original_config_root, original_env_file, original_api_state_root
    m.api_state_uid = original_api_state_uid

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


with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)/'repo'
    script = root/'scripts/reset-fresh-fast-testnet-20261107.py'
    wrapper = root/'ubuntu-reset-fresh-testnet-20261107.sh'
    write_text(script, '# reset fixture\n')
    write_text(wrapper, '#!/usr/bin/env bash\n')
    subprocess.run(['git', 'init', '--quiet'], cwd=root, check=True)
    subprocess.run(['git', 'config', 'user.email', 'test@example.invalid'], cwd=root, check=True)
    subprocess.run(['git', 'config', 'user.name', 'Reset Test'], cwd=root, check=True)
    subprocess.run(['git', 'add', '.'], cwd=root, check=True)
    subprocess.run(['git', 'commit', '--quiet', '-m', 'fixture'], cwd=root, check=True)
    original_repo, original_file = m.REPO, m.__file__
    m.REPO, m.__file__ = root, str(script)
    assert m.checked_source_revision()
    write_text(wrapper, '#!/usr/bin/env bash\n# staged modification\n')
    subprocess.run(['git', 'add', wrapper.name], cwd=root, check=True)
    try:
        m.checked_source_revision()
        raise AssertionError('staged reset source accepted')
    except RuntimeError:
        pass
    m.REPO, m.__file__ = original_repo, original_file


calls = []
m.run = lambda *args: calls.append(args)
m.unit_info = lambda unit: ('loaded', 'active' if unit.endswith('.timer') else 'inactive')
m.quiesce()
assert calls == [('systemctl', 'stop', unit) for unit in m.TIMER_UNITS]
assert not any(args[-1].endswith('.service') for args in calls)

states = [('loaded', 'inactive') for _ in range(len(m.TIMER_UNITS) * 2)]
m.unit_info = lambda unit: states.pop(0)
file_states = [state for _ in m.TIMER_UNITS for state in ('enabled', 'disabled')]
m.unit_file_state = lambda unit: file_states.pop(0)
m.run = lambda *args: calls.append(args)
m.disable_prior_schedulers()
assert calls[-len(m.TIMER_UNITS):] == [
    ('systemctl', 'disable', '--now', unit) for unit in m.TIMER_UNITS]

api_states = [('loaded', 'active'), ('loaded', 'inactive')]
m.unit_info = lambda unit: api_states.pop(0)
api_file_states = ['enabled', 'disabled']
m.unit_file_state = lambda unit: api_file_states.pop(0)
m.run = lambda *args: calls.append(args)
m.disable_api_service()
assert calls[-2:] == [
    ('systemctl', 'stop', m.API_SERVICE),
    ('systemctl', 'disable', '--now', m.API_SERVICE),
]

old_output = m.run_output
m.run_output = lambda *args: 'ZERO_START_ORACLES_CHECKED ready=true target=' + old
m.check_old_target_on_chain(old)
m.run_output = lambda *args: 'ZERO_START_ORACLES_CHECKED ready=true target=0x' + 'cd' * 20
try:
    m.check_old_target_on_chain(old)
    raise AssertionError('canonical target mismatch accepted')
except RuntimeError:
    pass
m.run_output = lambda *args: 'ZERO_START_AUTOMATION_CHECKED ready=true BLOCKERS=none target=' + old
m.final_readiness(old)
m.run_output = lambda *args: 'ZERO_START_AUTOMATION_CHECKED ready=true BLOCKERS=none target=0x' + 'cd' * 20
try:
    m.final_readiness(old)
    raise AssertionError('final readiness target mismatch accepted')
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
    original_config_root, original_env_file, original_api_state_root = m.CONFIG_ROOT, m.ENV_FILE, m.API_STATE_ROOT
    original_api_state_uid = m.api_state_uid
    original_base, original_session = m.BASE, m.SESSION
    original_geteuid = m.os.geteuid
    m.SYSTEMD_ROOT = root/'etc/systemd/system'
    m.CONFIG_ROOT = root/'etc/globaldroptrade'
    m.ENV_FILE = m.CONFIG_ROOT/'trades.env'
    m.API_STATE_ROOT = root/'var/lib/globaldroptrade-api'
    m.api_state_uid = lambda: os.getuid()
    override = m.SYSTEMD_ROOT/'globaldroptrade-zero-daily.service.d/split-index.conf'
    reliability_override = m.SYSTEMD_ROOT/'globaldroptrade-zero-daily.service.d/zz-daily-reliability.conf'
    timer_override = m.SYSTEMD_ROOT/'globaldroptrade-zero-daily.timer.d/split-index.conf'
    activity_policy = m.CONFIG_ROOT/'daily-activity-policy.json'
    activity_history = m.API_STATE_ROOT/'daily-activity.json'
    failover_status = base/'rpc-failover-v1/status.json'
    write_text(m.ENV_FILE, "TRADES_CHAIN_ID='97'\nTRADES_ZERO_START_PROFILE='global-fresh-fast-test-v1'\nTRADES_VAULT_ADDRESS='" + old + "'\nTRADES_RPC_URL='https://example.invalid'\nDAILY_ACTIVITY_FILE='/var/lib/globaldroptrade-api/daily-activity.json'\nDAILY_ACTIVITY_ACTIVATION_TIMESTAMP='1'\n")
    write(override, {'old': 'split-index-override'})
    write(reliability_override, {'old': 'daily-reliability-override'})
    write(timer_override, {'old': 'split-index-timer-override'})
    write(activity_policy, {'old': 'daily-activity-policy'})
    write(activity_history, {'old': 'daily-activity-history'})
    write(failover_status, {'status': 'apply-failed'})
    external = base/'automation-v1/journal.json'
    write(external, {'transactions': {'old': {'block': 1}}})
    staged = m.plan_archive(base, session, old, revision, m.digest(m.ENV_FILE))
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
    quiesce_calls = []
    m.quiesce = lambda *args, **kwargs: quiesce_calls.append((args, kwargs))
    m.disable_prior_schedulers = lambda: calls.append(('all-prior-timers-disabled',))
    m.reset_locks = lambda: ()
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
            assert json.loads((session/'session.json').read_text())['phase'] == 'automating'
            assert not override.exists()
            assert not reliability_override.exists()
            assert not timer_override.exists()
            assert not activity_policy.exists()
            assert not activity_history.exists()
            assert not failover_status.exists()

    original_archive_control = m.archive_retired_control_state

    def tracked_archive_control(*arguments):
        calls.append(('old-state-archive-begins',))
        return original_archive_control(*arguments)

    m.archive_retired_control_state = tracked_archive_control
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
    assert calls.index(('all-prior-timers-disabled',)) < calls.index(('old-state-archive-begins',))
    assert quiesce_calls == [
        ((), {'disable_api': True}), ((), {'disable_api': True}),
        ((), {'disable_api': True}), ((), {})]
    assert (session/'previous-control-state/systemd/zero-daily-split-index.conf').exists()
    assert (session/'previous-control-state/systemd/zero-daily-zz-daily-reliability.conf').exists()
    assert (session/'previous-control-state/systemd/zero-daily-timer-split-index.conf').exists()
    assert (session/'previous-control-state/etc/globaldroptrade/daily-activity-policy.json').exists()
    assert (session/'previous-control-state/var/lib/globaldroptrade-api/daily-activity.json').exists()
    assert (session/'previous-control-state/rpc-failover-v1/status.json').exists()
    assert (session/'previous-state/automation-v1/journal.json').exists()
    m.SYSTEMD_ROOT = original_systemd
    m.CONFIG_ROOT, m.ENV_FILE, m.API_STATE_ROOT = original_config_root, original_env_file, original_api_state_root
    m.api_state_uid = original_api_state_uid
    m.BASE, m.SESSION = original_base, original_session
    m.os.geteuid = original_geteuid

assert '0xB5c3C0f8fc30b2FDB8b16d2325127dAe7C8DCD5B' not in Path(m.__file__).read_text()
print('RESET_FRESH_FAST_TESTNET_20261107_OFFLINE_TESTS_PASSED: explicit target binding, chain guard, pending guard, immutable archive, preserved locks, installer backup preservation and resumable empty deployment')

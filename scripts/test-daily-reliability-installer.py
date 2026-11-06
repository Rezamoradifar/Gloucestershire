"""Exercise a release against a fake host, including crashes and live-service boundaries."""
from contextlib import redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import stat
import tempfile
import types
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('daily_release', REPO/'scripts/install-daily-reliability.py')
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)
REVISION = 'a1'*20
OLD_VAULT = M.TARGET


class FakeSystem:
    def __init__(self, root, source, names, mode='success'):
        self.root, self.source, self.names, self.mode = root, source, names, mode
        self.calls = []
        self.log = None
        self.monotonic = 0
        self.polls = 0
        self.states = {unit:{'loaded':False, 'active':'inactive', 'enabled':'not-found'}
                       for unit in (*M.TIMERS, *M.SERVICES, M.API)}
        for unit in (M.API, M.PAYMENT, M.FAILOVER, 'globaldroptrade-zero-daily.timer',
                     'globaldroptrade-rpc-failover.timer'):
            self.states[unit] = {'loaded':True, 'active':'active' if unit.endswith('.timer') or unit == M.API else 'inactive',
                                 'enabled':'enabled' if unit.endswith('.timer') else 'static'}
        if mode in ('busy', 'eventually-idle'):
            self.states[M.PAYMENT]['active'] = 'activating'

    def clock(self):
        return self.monotonic

    def sleep(self, seconds):
        self.monotonic += seconds

    def value(self, unit, property_name):
        self.calls.append(['show', unit, property_name])
        row = self.states.get(unit, {'loaded':False, 'active':'inactive', 'enabled':'not-found'})
        if property_name == 'LoadState':
            return 'loaded' if row['loaded'] else 'not-found'
        if property_name == 'User':
            return 'globaldroptrade-api'
        if property_name == 'ExecStart':
            file = self.root/'etc/systemd/system/globaldroptrade-zero-daily.service.d/zz-daily-reliability.conf'
            return file.read_text() if file.exists() else 'old worker'
        if property_name == 'ActiveState':
            if unit == M.PAYMENT and self.mode == 'eventually-idle':
                self.polls += 1
                if self.polls >= 5:
                    row['active'] = 'inactive'
            return row['active']
        return ''

    def enabled(self, unit):
        return self.states[unit]['enabled']

    def control(self, action, *units):
        return self.run(['systemctl', action, *units])

    def preflight(self, args):
        if self.mode == 'preflight-diagnostic-fail':
            secret = 'PRIVATE_RPC_KEY_MUST_NOT_LEAK'
            return json.dumps({
                'status':'blocked', 'error':'RELIABILITY_VERIFIED_RPC_REQUIRED',
                'phase':'RPC_VERIFICATION', 'operation':'unknown',
                'message':'https://provider.invalid/'+secret,
                'environment':{'PRIVATE_KEY':secret},
                'attempts':[
                    {'candidate':0, 'verified':False, 'phase':'HISTORICAL_STATE',
                     'operation':'accounts-native', 'reason':'HISTORICAL_STATE_UNAVAILABLE',
                     'errorCode':'SERVER_ERROR', 'rpcCode':-32000, 'httpStatus':503,
                     'block':42000, 'requestedTimestamp':1900000000,
                     'url':'https://provider.invalid/'+secret, 'calldata':secret,
                     'error':{'message':secret}},
                    {'candidate':1, 'verified':False, 'phase':[secret],
                     'operation':secret, 'reason':secret, 'errorCode':{'message':secret},
                     'rpcCode':2147483648, 'httpStatus':True, 'block':secret,
                     'requestedTimestamp':9007199254740992},
                    {'candidate':True, 'verified':False, 'reason':secret},
                    {'candidate':4, 'verified':False, 'reason':secret}],
                'transactionsSent':0, 'signerOpened':False})
        envfile = self.root/'etc/globaldroptrade/trades.env'
        financial_policy = self.root/'var/lib/globaldroptrade/fresh-fast-testnet-automation-v1/daily-policy.json'
        activityfile = self.root/'etc/globaldroptrade/daily-activity-policy.json'
        old_activity = activityfile.read_bytes() if activityfile.exists() else None
        activity = json.loads(old_activity) if old_activity else {
            'version':1, 'chainId':97, 'vaultAddress':M.TARGET,
            'origin':'https://globaldroptrade.com', 'windowSeconds':86400,
            'activationTimestamp':2000000000,
            'historyFile':'/var/lib/globaldroptrade-api/daily-activity.json'}
        env = envfile.read_bytes()
        next_env = env+b"\nDAILY_ACTIVITY_ACTIVATION_TIMESTAMP='2000000000'\n"
        report = {'version':1, 'kind':'global-daily-reliability-preflight',
                  'chainId':56 if self.mode == 'wrong-chain' else 97, 'target':M.TARGET,
                  'checkpoint':{'number':123, 'hash':'0x'+'12'*32, 'timestamp':1999913600},
                  'runtimeHash':'0x'+'34'*32, 'periodSeconds':900,
                  'reporterAuthorized':True, 'paused':False, 'verifiedRpcCount':1,
                  'activityPolicy':activity, 'activityPolicyAlreadyPresent':old_activity is not None,
                  'originalEnvSha256':M.digest(env), 'stagedEnvSha256':M.digest(next_env),
                  'dailyPolicySha256':M.digest(financial_policy.read_bytes()),
                  'originalJournalSha256':M.digest((financial_policy.parent/'journal.json').read_bytes()),
                  'originalActivityPolicySha256':M.digest(old_activity) if old_activity else None,
                  'transactionsSent':0, 'signerOpened':False}
        if '--stage' in args:
            stage = Path(args[args.index('--stage')+1])
            for name, data in (('trades.env', next_env),
                               ('daily-activity-policy.json', old_activity or (json.dumps(activity)+'\n').encode()),
                               ('preflight.json', json.dumps(report).encode())):
                file = stage/name
                file.write_bytes(data)
                file.chmod(0o600)
        return json.dumps(report)

    def run(self, args, cwd=None, env=None, timeout=None, check=True):
        args = list(map(str, args))
        self.calls.append(args)
        output, code = '', 0
        name = Path(args[0]).name
        if name == 'git':
            if args[1] == 'rev-parse':
                output = REVISION+'\n'
            elif args[1] == 'ls-files':
                output = '\0'.join(self.names)+'\0'
        elif name == 'node' and any('prepare-daily-reliability.mjs' in arg for arg in args):
            output = self.preflight(args)
            if self.mode == 'preflight-diagnostic-fail':
                code = 1
        elif name == 'npm':
            if self.mode == 'dependencies-fail' and args[1] == 'ci':
                code = 1
            elif args[1] == 'ci':
                (Path(cwd)/'node_modules').mkdir(exist_ok=True)
                (Path(cwd)/'node_modules/runtime.txt').write_text('locked dependencies')
            elif args[1:] == ['run', 'build']:
                dist = Path(cwd)/'dist'
                (dist/'assets').mkdir(parents=True)
                (dist/'index.html').write_text('<!doctype html><title>New reviewed frontend</title>\n')
                (dist/'assets/new.js').write_text('new application')
        elif name == 'nginx':
            conf = self.root/'etc/nginx/sites-available/globaldroptrade.com'
            if self.mode == 'nginx-fail' and 'daily-reliability-' in conf.read_text():
                code = 1
        elif name == 'systemctl':
            action, units = args[1], [unit for unit in args[2:] if not unit.startswith('--')]
            if action == 'daemon-reload':
                folder = self.root/'etc/systemd/system'
                for unit, row in self.states.items():
                    row['loaded'] = (folder/unit).is_file()
                    if row['loaded'] and row['enabled'] == 'not-found':
                        row['enabled'] = 'disabled' if unit.endswith('.timer') else 'static'
            else:
                for unit in units:
                    if unit == 'nginx':
                        continue
                    row = self.states[unit]
                    if action == 'stop':
                        if not unit.endswith('.timer'):
                            raise AssertionError('An in-flight service was stopped: '+unit)
                        row['active'] = 'inactive'
                    elif action == 'disable':
                        row['enabled'] = 'disabled'
                    elif action == 'enable':
                        row['enabled'] = 'enabled-runtime' if '--runtime' in args else 'enabled'
                        if '--now' in args:
                            row['active'] = 'active'
                        if self.mode == 'activation-fail' and unit == 'globaldroptrade-smart-worker.timer':
                            code = 1
                    elif action in ('start', 'restart'):
                        if action == 'restart' and unit != M.API:
                            raise AssertionError('A financial service was restarted')
                        row['active'] = 'active' if unit.endswith('.timer') or unit == M.API else 'inactive'
                        if unit == M.COORDINATOR:
                            # The installer must have released the financial lock.
                            import fcntl
                            lock = self.root/'var/lib/globaldroptrade/fresh-fast-testnet-automation-v1/run.lock'
                            with lock.open('r+') as stream:
                                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = types.SimpleNamespace(returncode=code, stdout=output, stderr='private diagnostic' if code else '')
        if check and code:
            raise M.InstallError('RELEASE_COMMAND_FAILED')
        return result

    def fetch(self, route):
        self.calls.append(['fetch', route])
        if route == '/api/health':
            return 200, json.dumps({'status':'ok', 'configured':True})
        if route == '/api/config':
            return 200, json.dumps({'version':1, 'chainId':97, 'vaultAddress':M.TARGET})
        if route.startswith('/api/trades'):
            if self.mode == 'feed-fail':
                return 503, json.dumps({'status':'unavailable'})
            return 200, json.dumps({'status':'live', 'chainId':97, 'contract':M.TARGET, 'trades':[]})
        if route.startswith('/?daily_release='):
            conf = (self.root/'etc/nginx/sites-available/globaldroptrade.com').read_text()
            import re
            root = re.search(r'\broot\s+([^;]+);', conf).group(1)
            return 200, (self.root/root.lstrip('/')/'index.html').read_text()
        if route.startswith('/api/daily-activity/'):
            activity = json.loads((self.root/'etc/globaldroptrade/daily-activity-policy.json').read_text())
            return 200, json.dumps({'version':1, 'chainId':97, 'vaultAddress':M.TARGET,
                                    'requirementEnabled':self.mode != 'activity-disabled',
                                    'windowSeconds':86400, 'activationTimestamp':activity['activationTimestamp']})
        if route in ('/automation-data/activation.json', '/deploy/zero-start-activation.json', '/api/automation/status'):
            return 200, json.dumps({'version':1, 'chainId':97, 'target':M.TARGET, 'status':'waiting'})
        raise AssertionError('Unexpected fetch: '+route)


class ReleaseTests(unittest.TestCase):
    def fixture(self, mode='success', existing_activity=False):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        source = root/'source'
        source.mkdir(mode=0o755)
        names = set(M.REQUIRED_CODE)|{'scripts/install-zero-start-status.py', 'package.json', 'package-lock.json',
                                    'website/package.json', 'website/package-lock.json', 'website/src/App.tsx',
                                    'ubuntu-enable-zero-daily.sh', 'ubuntu-api.sh'}
        names |= {'deployment-console/'+name for name in ('zero-start-activation.html', 'zero-start-activation.js', 'ethers.js', 'style.css')}
        for name in names:
            file = source/name
            file.parent.mkdir(parents=True, mode=0o755, exist_ok=True)
            file.write_text('reviewed '+name)
            file.chmod(0o644)
        shutil.copyfile(REPO/'scripts/install-zero-start-status.py', source/'scripts/install-zero-start-status.py')
        paths = ['etc/globaldroptrade', 'etc/systemd/system', 'etc/nginx/sites-available', 'etc/nginx/sites-enabled',
                 'opt/globaldroptrade-zero-daily/releases/old/scripts', 'opt/globaldroptrade-api/releases/old/server',
                 'var/lib/globaldroptrade/fresh-fast-testnet-automation-v1', 'var/www/globaldroptrade/releases/old/assets',
                 'var/www/globaldroptrade/automation-data', 'var/lib/globaldroptrade-api']
        for name in paths:
            (root/name).mkdir(parents=True, mode=0o755, exist_ok=True)
        for base in ('opt/globaldroptrade-zero-daily', 'opt/globaldroptrade-api'):
            (root/base/'current').symlink_to(root/base/'releases/old', target_is_directory=True)
            (root/base/'releases/old/package.json').write_text('{}\n')
        state = root/'var/lib/globaldroptrade/fresh-fast-testnet-automation-v1'
        state.chmod(0o700)
        journal = b'{"daily":{"epoch":9,"positionPaid":{"0xwallet:0":15}},"transactions":{"pending":{"raw":"KEEP_SIGNED_NONCE","hash":"0xpending"}}}\n'
        financial_policy = b'{"version":1,"chainId":97,"periodSeconds":900,"basis":"position-anniversary-principal","runtimeHash":"keep"}\n'
        for name, data in (('journal.json', journal), ('daily-policy.json', financial_policy), ('run.lock', b'unchanged lock inode')):
            (state/name).write_bytes(data)
            (state/name).chmod(0o600)
        env = root/'etc/globaldroptrade/trades.env'
        env.write_text('TRADES_CHAIN_ID=97\nTRADES_VAULT_ADDRESS='+M.TARGET+'\nCUSTOM_SECRET="must remain private"\n')
        env.chmod(0o600)
        api_state = root/'var/lib/globaldroptrade-api'
        api_state.chmod(0o700)
        history = api_state/'daily-activity.json'
        history.write_text('{"records":[{"signature":"PRESERVE_ACCEPTED_SIGNATURE"}]}\n')
        history.chmod(0o600)
        conf = root/'etc/nginx/sites-available/globaldroptrade.com'
        conf.write_text('server {\n listen 443 ssl;\n server_name globaldroptrade.com www.globaldroptrade.com;\n ssl_certificate /etc/letsencrypt/live/globaldroptrade.com/fullchain.pem;\n root /var/www/globaldroptrade/releases/old;\n location / { try_files $uri /index.html; }\n}\n')
        (root/'etc/nginx/sites-enabled/globaldroptrade.com').symlink_to(conf)
        (root/'var/www/globaldroptrade/releases/old/index.html').write_text('<title>Old release</title>\n')
        (root/'var/www/globaldroptrade/releases/old/manual-catalog.json').write_text('{"keep":"catalog"}')
        status = root/'var/www/globaldroptrade/automation-data/activation.json'
        status.write_text(json.dumps({'version':1, 'chainId':97, 'target':M.TARGET, 'ready':False}))
        if existing_activity:
            policy = {'version':1, 'chainId':97, 'vaultAddress':M.TARGET, 'origin':'https://globaldroptrade.com',
                      'windowSeconds':86400, 'activationTimestamp':1500000000,
                      'historyFile':'/var/lib/globaldroptrade-api/daily-activity.json'}
            file = root/'etc/globaldroptrade/daily-activity-policy.json'
            file.write_text(json.dumps(policy, indent=4)+'\n')
            file.chmod(0o600)
        system = FakeSystem(root, source, sorted(names), mode)
        for unit, value in system.states.items():
            if value['loaded']:
                (root/'etc/systemd/system'/unit).write_text('old '+unit+'\n')
        installer = M.Installer(source, root=root, system=system, expected_revision=REVISION,
                                clock=system.clock, sleep=system.sleep)
        self.addCleanup(patch.stopall)
        patch.object(M, 'ROOT_UID', os.geteuid()).start()
        patch.object(M, 'ROOT_GID', os.getegid()).start()
        patch.object(M.pwd, 'getpwnam', return_value=types.SimpleNamespace(pw_uid=os.geteuid(), pw_gid=os.getegid())).start()
        real_which = shutil.which
        patch.object(M.shutil, 'which', side_effect=lambda name:real_which(name) or '/usr/bin/'+name).start()
        return installer, system, root

    def state_snapshot(self, root):
        names = ['var/lib/globaldroptrade/fresh-fast-testnet-automation-v1/journal.json',
                 'var/lib/globaldroptrade/fresh-fast-testnet-automation-v1/daily-policy.json',
                 'var/lib/globaldroptrade-api/daily-activity.json']
        return {name:(root/name).read_bytes() for name in names}

    def assert_state_preserved(self, root, before, system):
        self.assertEqual(self.state_snapshot(root), before)
        self.assertFalse(any(call[:2] == ['systemctl', 'stop'] and any(unit in call for unit in M.SERVICES) for call in system.calls))
        self.assertFalse(any(call[:2] == ['systemctl', 'restart'] and any(unit in call for unit in M.SERVICES) for call in system.calls))

    def test_success_preserves_pending_signed_bytes_history_and_exact_financial_policy(self):
        installer, system, root = self.fixture()
        before = self.state_snapshot(root)
        lock = installer.state/'run.lock'
        inode = lock.stat().st_ino
        report = installer.apply()
        self.assertTrue(report['installed'])
        self.assertFalse(report['paymentReceiptVerified'])
        self.assert_state_preserved(root, before, system)
        self.assertEqual(lock.stat().st_ino, inode)
        self.assertEqual((installer.new_web/'manual-catalog.json').read_text(), '{"keep":"catalog"}')
        self.assertIn('ssl_certificate /etc/letsencrypt/live/globaldroptrade.com/fullchain.pem;', installer.conf.read_text())
        for name in ('automation-data/activation.json', 'deploy/zero-start-activation.json'):
            self.assertEqual((installer.new_web/name).resolve(), root/'var/www/globaldroptrade/automation-data/activation.json')
        self.assertEqual(system.states['globaldroptrade-smart-worker.timer']['active'], 'active')
        self.assertEqual(system.states['globaldroptrade-zero-daily.timer']['active'], 'inactive')
        self.assertEqual(system.states['globaldroptrade-zero-daily.timer']['enabled'], 'disabled')
        self.assertEqual((installer.release/'scripts/daily-activity-worker.mjs').read_text(), (installer.api_release/'scripts/daily-activity-worker.mjs').read_text())
        self.assertEqual(stat.S_IMODE(installer.backup.stat().st_mode), 0o700)
        self.assertNotIn('must remain private', json.dumps(report))

    def test_reinstall_never_moves_existing_activity_cutoff_or_rewrites_history(self):
        installer, system, root = self.fixture(existing_activity=True)
        original = installer.activity_policy.read_bytes()
        before = self.state_snapshot(root)
        report = installer.apply()
        self.assertEqual(report['activityActivationTimestamp'], 1500000000)
        self.assertEqual(installer.activity_policy.read_bytes(), original)
        self.assert_state_preserved(root, before, system)

    def test_private_umask_never_makes_api_code_or_dependencies_unreadable(self):
        installer, system, root = self.fixture()
        before = self.state_snapshot(root)
        old_umask = os.umask(0o077)
        try:
            installer.apply()
        finally:
            os.umask(old_umask)
        self.assert_state_preserved(root, before, system)
        for entry in (installer.api_release, *installer.api_release.rglob('*')):
            if entry.is_symlink():
                continue
            mode = stat.S_IMODE(entry.stat().st_mode)
            self.assertEqual(mode & 0o044, 0o044)
            if entry.is_dir():
                self.assertEqual(mode & 0o011, 0o011)
            self.assertEqual(mode & 0o022, 0)
        self.assertEqual(stat.S_IMODE(installer.envfile.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(installer.backup.stat().st_mode), 0o700)

    def test_default_read_only_check_changes_no_files_or_services(self):
        installer, system, root = self.fixture()
        before = {str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file() and not p.is_symlink()}
        installer.inspect()
        installer.preflight()
        after = {str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file() and not p.is_symlink()}
        self.assertEqual(before, after)
        self.assertFalse(any(call[:1] == ['systemctl'] for call in system.calls))

    def test_bad_rpc_identity_fails_before_dependencies_or_live_mutation(self):
        installer, system, root = self.fixture('wrong-chain')
        before = self.state_snapshot(root)
        with self.assertRaisesRegex(M.InstallError, 'PREFLIGHT_IDENTITY'):
            installer.apply()
        self.assert_state_preserved(root, before, system)
        self.assertFalse(any(Path(call[0]).name == 'npm' for call in system.calls))
        self.assertFalse(any(call[:1] == ['systemctl'] for call in system.calls))

    def test_failed_preflight_prints_useful_private_safe_diagnostics_before_stopping(self):
        installer, system, root = self.fixture('preflight-diagnostic-fail')
        before = {str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file() and not p.is_symlink()}
        links = {str(p.relative_to(root)):os.readlink(p) for p in root.rglob('*') if p.is_symlink()}
        with self.assertRaisesRegex(M.InstallError, 'RELIABILITY_VERIFIED_RPC_REQUIRED') as caught:
            installer.apply()
        output = io.StringIO()
        with redirect_stdout(output):
            M.print_install_error(caught.exception)
        text = output.getvalue()
        body, marker, code = text.partition('GLOBAL_DAILY_RELEASE_STOPPED ')
        report = json.loads(body)
        self.assertEqual(marker+code, 'GLOBAL_DAILY_RELEASE_STOPPED RELIABILITY_VERIFIED_RPC_REQUIRED\n')
        self.assertEqual(report['kind'], 'global-daily-reliability-preflight-failure')
        self.assertEqual(report['phase'], 'RPC_VERIFICATION')
        self.assertEqual(report['attempts'][0], {
            'candidate':0, 'verified':False, 'phase':'HISTORICAL_STATE',
            'operation':'accounts-native', 'reason':'HISTORICAL_STATE_UNAVAILABLE',
            'errorCode':'SERVER_ERROR', 'rpcCode':-32000, 'httpStatus':503,
            'block':42000, 'requestedTimestamp':1900000000})
        self.assertEqual(len(report['attempts']), 2)
        self.assertEqual(report['attempts'][1]['reason'], 'UNKNOWN')
        for field in ('errorCode', 'rpcCode', 'httpStatus', 'block', 'requestedTimestamp'):
            self.assertIsNone(report['attempts'][1][field])
        for secret in ('PRIVATE_RPC_KEY_MUST_NOT_LEAK', 'provider.invalid', 'calldata', 'environment', 'KEEP_SIGNED_NONCE'):
            self.assertNotIn(secret, text)
        self.assertEqual(before, {str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file() and not p.is_symlink()})
        self.assertEqual(links, {str(p.relative_to(root)):os.readlink(p) for p in root.rglob('*') if p.is_symlink()})
        self.assertFalse(any(call[:1] == ['systemctl'] or Path(call[0]).name == 'npm' for call in system.calls))
        self.assertIsNone(installer.backup)
        self.assertIsNone(system.log)

    def test_unknown_uppercase_provider_codes_cannot_reach_the_terminal(self):
        secret = 'PRIVATE_PROVIDER_CREDENTIAL'
        output = io.StringIO()
        error = M.InstallError(secret, safe_report={'error':secret, 'phase':secret,
                              'operation':secret, 'reason':secret, 'message':secret})
        with redirect_stdout(output):
            M.print_install_error(error)
        text = output.getvalue()
        self.assertNotIn(secret, text)
        self.assertTrue(text.endswith('GLOBAL_DAILY_RELEASE_STOPPED READ_ONLY_PREFLIGHT_FAILED\n'))

    def test_non_object_preflight_output_fails_with_a_fixed_code(self):
        installer, system, root = self.fixture()
        before = self.state_snapshot(root)
        with patch.object(system, 'preflight', return_value='[]'):
            with self.assertRaisesRegex(M.InstallError, 'READ_ONLY_PREFLIGHT_REPORT_REQUIRED'):
                installer.apply()
        self.assert_state_preserved(root, before, system)
        self.assertFalse(any(call[:1] == ['systemctl'] for call in system.calls))

    def test_failed_staging_leaves_current_services_and_sources_running(self):
        installer, system, root = self.fixture('dependencies-fail')
        before = self.state_snapshot(root)
        with self.assertRaises(M.InstallError):
            installer.apply()
        self.assert_state_preserved(root, before, system)
        self.assertFalse(any(call[:2] == ['systemctl', 'stop'] for call in system.calls))
        self.assertEqual((root/'opt/globaldroptrade-zero-daily/current').resolve().name, 'old')

    def test_busy_signer_is_not_killed_and_original_timers_resume(self):
        installer, system, root = self.fixture('busy')
        before = self.state_snapshot(root)
        with self.assertRaisesRegex(M.InstallError, 'STILL_BUSY'):
            installer.apply()
        self.assert_state_preserved(root, before, system)
        self.assertEqual((root/'opt/globaldroptrade-zero-daily/current').resolve().name, 'old')
        self.assertEqual(system.states['globaldroptrade-zero-daily.timer']['active'], 'active')

    def test_installation_waits_for_an_in_flight_payment_before_switching_code(self):
        installer, system, root = self.fixture('eventually-idle')
        before = self.state_snapshot(root)
        self.assertTrue(installer.apply()['installed'])
        self.assertGreaterEqual(system.polls, 5)
        self.assert_state_preserved(root, before, system)

    def test_feed_or_activity_failure_restores_code_and_ssl_but_never_financial_state(self):
        for mode in ('feed-fail', 'activity-disabled', 'nginx-fail'):
            with self.subTest(mode=mode):
                installer, system, root = self.fixture(mode)
                before = self.state_snapshot(root)
                old_conf = (root/'etc/nginx/sites-available/globaldroptrade.com').read_bytes()
                old_env = installer.envfile.read_bytes()
                with self.assertRaises(M.InstallError):
                    installer.apply()
                self.assert_state_preserved(root, before, system)
                self.assertEqual(installer.conf.read_bytes(), old_conf)
                self.assertEqual(installer.envfile.read_bytes(), old_env)
                self.assertEqual((root/'opt/globaldroptrade-zero-daily/current').resolve().name, 'old')
                self.assertEqual((root/'opt/globaldroptrade-api/current').resolve().name, 'old')
                self.assertEqual(system.states['globaldroptrade-zero-daily.timer']['active'], 'active')
                manifest = json.loads((installer.backup/'manifest.json').read_text())
                self.assertFalse(manifest['financialStateRestorable'])
                self.assertFalse(any('/journal.json' in name or name.endswith('/daily-policy.json') or name.endswith('/daily-activity.json') for name in manifest['snapshots']))

    def test_activation_failure_keeps_reviewed_code_and_pauses_scheduling(self):
        installer, system, root = self.fixture('activation-fail')
        before = self.state_snapshot(root)
        with self.assertRaises(M.InstallError):
            installer.apply()
        self.assert_state_preserved(root, before, system)
        self.assertEqual((root/'opt/globaldroptrade-zero-daily/current').resolve(), installer.release)
        self.assertTrue(installer.activity_policy.exists())
        self.assertEqual(system.states['globaldroptrade-smart-worker.timer']['active'], 'inactive')
        self.assertEqual(system.states['globaldroptrade-zero-daily.timer']['active'], 'inactive')


if __name__ == '__main__':
    unittest.main(buffer=True)

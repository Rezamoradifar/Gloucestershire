#!/usr/bin/env python3
"""Update the existing verified Global testnet services without replacing financial state.

Default invocation is read-only. --apply stages a complete release, waits for
in-flight financial work, and switches only code/configuration. Signing keys,
deployment proofs, balances, financial policies and journals are never replaced.
"""
import argparse
import base64
from contextlib import ExitStack, contextmanager
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import types
import uuid


TARGET = '0xB5c3C0f8fc30b2FDB8b16d2325127dAe7C8DCD5B'
# Tests substitute only these ownership identities on an isolated fake host.
# The production CLI always requires uid 0 and these defaults are never inputs.
ROOT_UID = 0
ROOT_GID = 0
API = 'globaldroptrade-api.service'
PAYMENT = 'globaldroptrade-zero-daily.service'
INDEX = 'globaldroptrade-position-index.service'
COORDINATOR = 'globaldroptrade-smart-worker.service'
FAILOVER = 'globaldroptrade-rpc-failover.service'
BUSY = ('active', 'activating', 'deactivating', 'reloading')
TIMERS = ('globaldroptrade-smart-worker.timer', 'globaldroptrade-rpc-failover.timer',
          'globaldroptrade-position-index.timer', 'globaldroptrade-zero-daily.timer',
          'globaldroptrade-automation.timer', 'globaldroptrade-oracles.timer')
SERVICES = (COORDINATOR, FAILOVER, INDEX, PAYMENT,
            'globaldroptrade-automation.service', 'globaldroptrade-oracles.service')
FINANCIAL_LOCKS = ('/var/lib/globaldroptrade/fresh-fast-testnet-connection/run.lock',
                   '/var/lib/globaldroptrade/zero-oracle-repair-v1/setup.lock',
                   '/var/lib/globaldroptrade/fresh-fast-testnet-automation-v1/setup.lock',
                   '/var/lib/globaldroptrade/fresh-fast-testnet-automation-v1/run.lock')
CODE_DIRS = ('scripts', 'server', 'artifacts', 'config', 'deployment-console')
REQUIRED_CODE = ('server/trades-api.mjs', 'server/daily-activity.mjs',
                 'server/automation-status.mjs', 'scripts/daily-activity.mjs',
                 'scripts/daily-activity-worker.mjs', 'scripts/daily-profit.mjs',
                 'scripts/position-profit.mjs', 'scripts/zero-start-automation.mjs',
                 'scripts/index-zero-positions.mjs', 'scripts/smart-worker.py',
                 'scripts/prepare-daily-reliability.mjs')


class InstallError(Exception):
    """Only fixed diagnostic codes may reach the terminal."""


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe_file(file, private=False, optional=False, max_size=33554432):
    try:
        fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        if optional:
            return None
        raise InstallError('REQUIRED_MANAGED_FILE_MISSING') from None
    except OSError:
        raise InstallError('MANAGED_FILE_UNSAFE') from None
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != ROOT_UID or
                info.st_mode & (0o077 if private else 0o022) or info.st_size > max_size):
            raise InstallError('MANAGED_FILE_UNSAFE')
        return stream.read()


def safe_directory(directory, mode=0o755, create=False, uid=None, gid=None):
    uid = ROOT_UID if uid is None else uid
    gid = ROOT_GID if gid is None else gid
    directory = Path(directory)
    if create and not directory.exists() and not directory.is_symlink():
        directory.mkdir(parents=True, mode=mode)
        directory.chmod(mode)
        os.chown(directory, uid, gid)
    info = directory.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != uid or
            info.st_mode & (0o077 if mode == 0o700 else 0o022)):
        raise InstallError('MANAGED_DIRECTORY_UNSAFE')
    return directory


def atomic_file(file, data, mode=0o600):
    file = Path(file)
    safe_directory(file.parent, mode=0o700 if file.parent.stat().st_mode & 0o077 == 0 else 0o755)
    fd, temporary = tempfile.mkstemp(prefix='.daily-release-', dir=file.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, file)
        directory = os.open(file.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def atomic_link(file, target):
    file = Path(file)
    temporary = file.with_name('.daily-next-'+uuid.uuid4().hex)
    try:
        temporary.symlink_to(target, target_is_directory=True)
        os.replace(temporary, file)
        descriptor = os.open(file.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if temporary.is_symlink():
            temporary.unlink()


def readable_code_release(directory):
    """Only staged public code is made readable to the API service identity."""
    directory = Path(directory)
    for current, directories, files in os.walk(directory, followlinks=False):
        Path(current).chmod(0o755)
        for name in directories+files:
            entry = Path(current)/name
            if entry.is_symlink():
                try:
                    entry.resolve(strict=True).relative_to(directory)
                except (OSError, ValueError):
                    raise InstallError('STAGED_DEPENDENCY_LINK_UNSAFE') from None
            elif name in files:
                metadata = entry.lstat()
                if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != ROOT_UID:
                    raise InstallError('STAGED_CODE_ENTRY_UNSAFE')
                entry.chmod(0o755 if metadata.st_mode & 0o111 else 0o644)


class System:
    def __init__(self):
        self.log = None

    def run(self, args, cwd=None, env=None, timeout=120, check=True):
        try:
            result = subprocess.run(args, cwd=cwd, env=env, text=True,
                                    capture_output=True, timeout=timeout, check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise InstallError('RELEASE_COMMAND_UNAVAILABLE_OR_TIMED_OUT') from None
        if self.log:
            with self.log.open('ab') as log:
                log.write(('COMMAND '+Path(str(args[0])).name+'\n').encode())
                log.write(result.stdout.encode(errors='replace'))
                log.write(result.stderr.encode(errors='replace'))
        if check and result.returncode:
            raise InstallError('RELEASE_COMMAND_FAILED')
        return result

    def value(self, unit, property_name):
        result = self.run(['systemctl', 'show', unit, '--property='+property_name, '--value'], check=False)
        return result.stdout.strip()

    def enabled(self, unit):
        return self.run(['systemctl', 'is-enabled', unit], check=False).stdout.strip()

    def control(self, action, *units):
        self.run(['systemctl', action, *units])

    def fetch(self, route):
        result = self.run(['curl', '--silent', '--show-error', '--noproxy', '*',
                           '--connect-timeout', '3', '--max-time', '15',
                           '--resolve', 'globaldroptrade.com:443:127.0.0.1',
                           '-H', 'Cache-Control: no-cache',
                           '--write-out', '\n%{http_code}',
                           'https://globaldroptrade.com'+route], timeout=20)
        body, _, code = result.stdout.rpartition('\n')
        if not re.fullmatch(r'[1-5][0-9][0-9]', code):
            raise InstallError('LOCAL_HTTPS_STATUS_REQUIRED')
        return int(code), body


class Installer:
    def __init__(self, source, root=Path('/'), system=None, expected_revision=None,
                 rpc_file=None, clock=time.monotonic, sleep=time.sleep):
        self.source = Path(source).resolve()
        self.root = Path(root).resolve()
        self.system = system or System()
        self.expected_revision = expected_revision
        self.rpc_file = rpc_file
        self.clock, self.sleep = clock, sleep
        self.phase = 'CHECKING'
        self.backup = None
        self.snapshots = {}
        self.changed = False
        self.payments_may_have_started = False
        self.states = {}
        self.release = None

    def p(self, value):
        return self.root/value.lstrip('/')

    @property
    def state(self):
        return self.p('/var/lib/globaldroptrade/fresh-fast-testnet-automation-v1')

    @property
    def envfile(self):
        return self.p('/etc/globaldroptrade/trades.env')

    @property
    def activity_policy(self):
        return self.p('/etc/globaldroptrade/daily-activity-policy.json')

    def announce(self, phase):
        self.phase = phase
        print('GLOBAL_DAILY_RELEASE phase='+phase, flush=True)

    def current(self, base):
        base = self.p(base)
        link = base/'current'
        if not link.is_symlink() or link.lstat().st_uid != ROOT_UID:
            raise InstallError('EXISTING_MANAGED_RELEASE_REQUIRED')
        target = link.resolve(strict=True)
        if target.parent != base/'releases' or not re.fullmatch(r'[A-Za-z0-9._-]+', target.name):
            raise InstallError('EXISTING_MANAGED_RELEASE_REQUIRED')
        safe_directory(target)
        safe_file(target/'package.json')
        return target

    def web_configuration(self):
        conf = self.p('/etc/nginx/sites-available/globaldroptrade.com')
        enabled = self.p('/etc/nginx/sites-enabled/globaldroptrade.com')
        text = safe_file(conf).decode()
        if not enabled.is_symlink() or enabled.lstat().st_uid != ROOT_UID or enabled.resolve(strict=True) != conf:
            raise InstallError('ACTIVE_MANAGED_NGINX_REQUIRED')
        # Loading the existing parser must not write __pycache__ in --check.
        parser_file = self.source/'scripts/install-zero-start-status.py'
        module = types.ModuleType('daily_status_paths')
        module.__file__ = str(parser_file)
        exec(compile(safe_file(parser_file), str(parser_file), 'exec'), module.__dict__)
        roots = module._roots(text)
        if len(roots) != 1:
            raise InstallError('ONE_MANAGED_WEB_ROOT_REQUIRED')
        declared = next(iter(roots))
        if not re.fullmatch(r'/var/www/globaldroptrade/releases/[A-Za-z0-9][A-Za-z0-9._-]*', declared):
            raise InstallError('ONE_MANAGED_WEB_ROOT_REQUIRED')
        webroot = self.p(declared)
        safe_directory(webroot)
        safe_file(webroot/'index.html')
        return conf, text, declared, webroot

    def inspect(self):
        safe_directory(self.source)
        for name in REQUIRED_CODE:
            safe_file(self.source/name)
        for base in ('/etc/globaldroptrade', '/etc/systemd/system', '/opt/globaldroptrade-zero-daily',
                     '/opt/globaldroptrade-api'):
            safe_directory(self.p(base))
        safe_directory(self.state, mode=0o700)
        safe_file(self.envfile, private=True)
        safe_file(self.state/'daily-policy.json', private=True)
        journal = json.loads(safe_file(self.state/'journal.json', private=True))
        if not isinstance(journal, dict) or not isinstance(journal.get('daily'), dict):
            raise InstallError('EXISTING_FINANCIAL_JOURNAL_REQUIRED')
        self.old_worker = self.current('/opt/globaldroptrade-zero-daily')
        self.old_api = self.current('/opt/globaldroptrade-api')
        for name in ('/opt', '/opt/globaldroptrade-api', '/opt/globaldroptrade-api/releases'):
            parent = safe_directory(self.p(name))
            if stat.S_IMODE(parent.stat().st_mode) & 0o055 != 0o055:
                raise InstallError('API_RELEASE_PARENT_NOT_SERVICE_READABLE')
        self.conf, self.old_conf, self.old_web_declared, self.old_web = self.web_configuration()
        for unit in (PAYMENT, API):
            if self.system.value(unit, 'LoadState') != 'loaded':
                raise InstallError('EXISTING_WORKER_AND_API_REQUIRED')
        if self.system.value(API, 'User') != 'globaldroptrade-api':
            raise InstallError('MANAGED_API_SERVICE_USER_REQUIRED')
        self.api_user = pwd.getpwnam('globaldroptrade-api')
        for name in ('curl', 'systemctl', 'nginx', 'git'):
            if not shutil.which(name):
                raise InstallError('RELEASE_RUNTIME_COMMAND_REQUIRED')
        architecture = {'x86_64':'x64', 'aarch64':'arm64'}.get(os.uname().machine)
        managed = self.p('/opt/globaldroptrade-node/node-v22.23.3-linux-'+str(architecture)+'/bin/node')
        system_node = shutil.which('node')
        if not managed.is_file() and not system_node:
            raise InstallError('SYSTEM_READABLE_NODE_REQUIRED')
        self.node = str(managed if managed.is_file() else Path(system_node).resolve())
        if self.node.startswith('/root/') or not os.access(self.node, os.X_OK):
            raise InstallError('SYSTEM_READABLE_NODE_REQUIRED')
        sibling_npm = Path(self.node).with_name('npm')
        self.npm = str(sibling_npm) if sibling_npm.is_file() else shutil.which('npm')
        if not self.npm:
            raise InstallError('RELEASE_RUNTIME_COMMAND_REQUIRED')
        self.system.run([self.node, '-e', 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<12))process.exit(1)'])
        git_environment = {**os.environ, 'GIT_OPTIONAL_LOCKS':'0'}
        revision = self.system.run(['git', 'rev-parse', 'HEAD'], cwd=self.source, env=git_environment).stdout.strip()
        if not re.fullmatch(r'[0-9a-f]{40}', revision) or self.expected_revision and revision != self.expected_revision:
            raise InstallError('EXPECTED_SOURCE_REVISION_REQUIRED')
        self.revision = revision
        self.system.run(['git', 'diff', '--exit-code', 'HEAD', '--', *CODE_DIRS, 'website',
                         'package.json', 'package-lock.json', '*.sh'], cwd=self.source, env=git_environment)
        self.system.run(['nginx', '-t'])
        return {'version':1, 'chainId':97, 'target':TARGET, 'sourceRevision':revision,
                'managedWorker':str(self.old_worker), 'managedApi':str(self.old_api),
                'webRoot':self.old_web_declared, 'transactionsSent':0, 'signerOpened':False}

    def preflight(self, runtime=None, stage=None):
        args = [self.node, str(self.source/'scripts/prepare-daily-reliability.mjs'),
                '--runtime', str(runtime or self.old_worker)]
        args += ['--stage', str(stage)] if stage else ['--check']
        if self.rpc_file:
            args += ['--rpc-file', str(self.rpc_file)]
        result = self.system.run(args, cwd=runtime or self.old_worker, timeout=240, check=False)
        try:
            report = json.loads(result.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError):
            raise InstallError('READ_ONLY_PREFLIGHT_REPORT_REQUIRED') from None
        if result.returncode or report.get('kind') != 'global-daily-reliability-preflight':
            error = report.get('error', '')
            raise InstallError(error if re.fullmatch(r'[A-Z][A-Z0-9_]+', error) else 'READ_ONLY_PREFLIGHT_FAILED')
        if report.get('chainId') != 97 or report.get('target', '').lower() != TARGET.lower() or report.get('signerOpened') is not False or report.get('transactionsSent') != 0:
            raise InstallError('READ_ONLY_PREFLIGHT_IDENTITY_REQUIRED')
        return report

    def snapshot(self, file):
        file = Path(file)
        key = '/'+str(file.relative_to(self.root))
        if key in self.snapshots:
            return
        if file.is_symlink():
            if file.lstat().st_uid != ROOT_UID:
                raise InstallError('UNSAFE_RELEASE_LINK')
            entry = {'kind':'link', 'target':os.readlink(file)}
        elif file.exists():
            data = safe_file(file)
            entry = {'kind':'file', 'data':base64.b64encode(data).decode(),
                     'mode':stat.S_IMODE(file.stat().st_mode)}
        else:
            entry = {'kind':'absent'}
        self.snapshots[key] = entry
        self.save_manifest()

    def save_manifest(self):
        if self.backup:
            manifest = {'version':1, 'kind':'global-daily-reliability-backup', 'target':TARGET,
                        'sourceRevision':self.revision, 'phase':self.phase,
                        'snapshots':self.snapshots, 'unitStates':self.states,
                        'financialStateRestorable':False}
            atomic_file(self.backup/'manifest.json', (json.dumps(manifest, indent=2)+'\n').encode())

    @contextmanager
    def lock(self, file):
        file = Path(file)
        safe_directory(file.parent, mode=0o700, create=True)
        fd = os.open(file, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            s = os.fstat(fd)
            if not stat.S_ISREG(s.st_mode) or s.st_uid != ROOT_UID or s.st_mode & 0o077:
                raise InstallError('PRIVATE_STABLE_LOCK_REQUIRED')
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise InstallError('RELEASE_OR_FINANCIAL_STATE_BUSY') from None
            yield
        finally:
            os.close(fd)

    def tracked_files(self):
        names = self.system.run(['git', 'ls-files', '-z'], cwd=self.source).stdout.split('\0')
        return [name for name in names if name and (name.split('/')[0] in (*CODE_DIRS, 'website') or
                name in ('package.json', 'package-lock.json') or '/' not in name and name.endswith('.sh'))]

    def stage_release(self):
        self.announce('STAGING')
        if shutil.disk_usage(self.p('/opt')).free < 1024*1024*1024:
            raise InstallError('RELEASE_REQUIRES_ONE_GIB_FREE')
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S')+'-'+uuid.uuid4().hex[:10]
        backup_root = safe_directory(self.p('/var/backups/globaldroptrade/daily-reliability'), mode=0o700, create=True)
        self.backup = backup_root/stamp
        self.backup.mkdir(mode=0o700)
        self.system.log = self.backup/'install.log'
        self.system.log.touch(mode=0o600)
        self.save_manifest()
        self.release = self.p('/opt/globaldroptrade-zero-daily/releases/daily-reliability-'+stamp)
        self.release.mkdir(mode=0o755)
        build = self.backup/'frontend'
        build.mkdir(mode=0o700)
        names = self.tracked_files()
        for name in names:
            relative = Path(name)
            if relative.is_absolute() or '..' in relative.parts:
                raise InstallError('UNSAFE_SOURCE_PATH')
            data = safe_file(self.source/relative, max_size=134217728)
            destination = build/relative.relative_to('website') if relative.parts[0] == 'website' else self.release/relative
            destination.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            destination.write_bytes(data)
            destination.chmod(0o755 if os.access(self.source/relative, os.X_OK) else 0o644)
        for name in REQUIRED_CODE:
            safe_file(self.release/name)
        if not (build/'package-lock.json').is_file():
            raise InstallError('LOCKED_FRONTEND_SOURCE_REQUIRED')
        environment = dict(os.environ)
        environment['PATH'] = str(Path(self.node).parent)+':'+environment.get('PATH', '')
        environment['VITE_CHAIN_ID'] = '97'
        environment['VITE_VAULT_ADDRESS'] = TARGET
        self.system.run([self.npm, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=self.release, env=environment, timeout=600)
        self.system.run([self.npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=build, env=environment, timeout=600)
        self.system.run([self.npm, 'run', 'build'], cwd=build, env=environment, timeout=600)
        readable_code_release(self.release)
        for name in REQUIRED_CODE:
            if name.endswith('.mjs'):
                self.system.run([self.node, '--check', str(self.release/name)])
        self.preflight(runtime=self.release)
        self.api_release = self.p('/opt/globaldroptrade-api/releases/daily-reliability-'+stamp)
        shutil.copytree(self.release, self.api_release, symlinks=True)
        self.failover_release = self.p('/opt/globaldroptrade-rpc-failover/releases/daily-reliability-'+stamp)
        self.failover_release.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        shutil.copytree(self.release, self.failover_release, symlinks=True)
        self.new_web_declared = '/var/www/globaldroptrade/releases/daily-reliability-'+stamp
        self.new_web = self.p(self.new_web_declared)
        self.copy_website(build/'dist')
        release_info = (json.dumps({'sourceRevision':self.revision, 'chainId':97, 'target':TARGET})+'\n').encode()
        for directory in (self.release, self.api_release, self.failover_release):
            (directory/'daily-reliability-release.json').write_bytes(release_info)
            (directory/'daily-reliability-release.json').chmod(0o644)

    def copy_website(self, dist):
        safe_file(dist/'index.html')
        # Preserve unrelated deployed assets and consoles. Never follow a link
        # from a web tree into private application state.
        for directory, directories, files in os.walk(self.old_web, followlinks=False):
            for name in directories+files:
                entry = Path(directory)/name
                if entry.is_symlink():
                    if name in directories:
                        raise InstallError('UNEXPECTED_WEB_DIRECTORY_LINK')
                    try:
                        entry.resolve(strict=False).relative_to(self.p('/var/www/globaldroptrade'))
                    except ValueError:
                        raise InstallError('UNEXPECTED_WEB_SYMLINK') from None
        shutil.copytree(self.old_web, self.new_web, symlinks=True)
        for directory, directories, files in os.walk(dist, followlinks=False):
            relative = Path(directory).relative_to(dist)
            destination = self.new_web/relative
            if destination.is_symlink():
                raise InstallError('UNEXPECTED_FRONTEND_DIRECTORY_LINK')
            destination.mkdir(parents=True, mode=0o755, exist_ok=True)
            for name in directories+files:
                if (Path(directory)/name).is_symlink():
                    raise InstallError('UNEXPECTED_FRONTEND_BUILD_LINK')
            for name in files:
                target = destination/name
                if target.is_symlink():
                    target.unlink()
                shutil.copyfile(Path(directory)/name, target)
        for directory, directories, files in os.walk(self.new_web, followlinks=False):
            Path(directory).chmod(0o755)
            for name in files:
                file = Path(directory)/name
                if not file.is_symlink():
                    file.chmod(0o644)
        public_status = self.p('/var/www/globaldroptrade/automation-data/activation.json')
        for relative in ('automation-data/activation.json', 'deploy/zero-start-activation.json'):
            destination = self.new_web/relative
            if destination.parent.is_symlink():
                raise InstallError('UNEXPECTED_STATUS_DIRECTORY_LINK')
            destination.parent.mkdir(mode=0o755, exist_ok=True)
            if destination.exists() and destination.is_dir():
                raise InstallError('UNEXPECTED_STATUS_ENTRY')
            atomic_link(destination, public_status)
        console = self.new_web/'deploy/daily-reliability-status'
        console.mkdir(mode=0o755, exist_ok=True)
        for name in ('zero-start-activation.html', 'zero-start-activation.js', 'ethers.js', 'style.css'):
            target = console/name
            target.write_bytes(safe_file(self.source/'deployment-console'/name))
            target.chmod(0o644)
        entry = self.new_web/'deploy/zero-start-activation.html'
        entry.write_text('<!doctype html><html lang="en" dir="ltr"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=./daily-reliability-status/zero-start-activation.html"><title>Global daily status</title><a href="./daily-reliability-status/zero-start-activation.html">Open daily status</a></html>\n')
        entry.chmod(0o644)

    def capture_units(self):
        for unit in (*TIMERS, *SERVICES, API):
            load = self.system.value(unit, 'LoadState')
            active = self.system.value(unit, 'ActiveState')
            if load not in ('loaded', 'not-found', '') or active not in (*BUSY, 'inactive', 'failed', ''):
                raise InstallError('UNEXPECTED_SYSTEMD_UNIT_STATE')
            self.states[unit] = {'loaded':load == 'loaded', 'active':active,
                                 'enabled':self.system.enabled(unit) if load == 'loaded' else 'not-found'}
        self.save_manifest()

    def wait_idle(self, units, seconds=300):
        deadline, last = self.clock()+seconds, 0
        while True:
            busy = [unit for unit in units if self.states.get(unit, {}).get('loaded') and self.system.value(unit, 'ActiveState') in BUSY]
            if not busy:
                return
            if self.clock() >= deadline:
                raise InstallError('FINANCIAL_SERVICE_STILL_BUSY_RETRY_LATER')
            if self.clock()-last >= 15:
                print('GLOBAL_DAILY_RELEASE waitingFor='+','.join(busy), flush=True)
                last = self.clock()
            self.sleep(2)

    def quiesce(self):
        self.announce('WAITING_FOR_IN_FLIGHT_WORK')
        self.capture_units()
        for timer in TIMERS:
            if self.states[timer]['loaded']:
                self.system.control('stop', timer)
        # No stop/restart is ever sent to a signer, indexer, coordinator or
        # failover service. A signed transaction may outlive its HTTP request.
        self.wait_idle(SERVICES)
        # A finishing older failover operation can restart a timer.
        for timer in TIMERS:
            if self.states[timer]['loaded']:
                self.system.control('stop', timer)
        self.wait_idle(SERVICES)

    def write_managed(self, file, text, mode=0o644):
        file = Path(file)
        if not file.parent.exists():
            safe_directory(file.parent, create=True)
        self.snapshot(file)
        self.changed = True
        atomic_file(file, text.encode() if isinstance(text, str) else text, mode)

    def unit_files(self):
        worker = self.p('/opt/globaldroptrade-zero-daily/current')
        api = self.p('/opt/globaldroptrade-api/current')
        public = self.p('/var/www/globaldroptrade/automation-data')
        units = self.p('/etc/systemd/system')
        activity = self.activity_policy
        self.write_managed(units/(PAYMENT+'.d/zz-daily-reliability.conf'), f'''[Service]
WorkingDirectory={worker}
ExecStart=
ExecStart=/usr/bin/flock -w 90 -E 75 {self.state}/run.lock {self.node} {worker}/scripts/zero-start-automation.mjs --execute --fast-testnet --hourly-test --indexed-payments
Environment=GLOBAL_DAILY_ACTIVITY_POLICY={activity}
TimeoutStartSec=infinity
ReadWritePaths={self.state} {public}
''')
        self.write_managed(units/(API+'.d/zz-daily-reliability.conf'), f'''[Service]
WorkingDirectory={api}
EnvironmentFile={self.envfile}
ExecStart=
ExecStart={self.node} {api}/server/trades-api.mjs
ReadWritePaths={self.p('/var/lib/globaldroptrade-api')}
''')
        self.write_managed(units/INDEX, f'''[Unit]
Description=Global signer-free deposit and reinvestment index
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=root
UMask=0077
WorkingDirectory={worker}
ExecStart={self.node} {worker}/scripts/index-zero-positions.mjs --execute --fast-testnet
TimeoutStartSec=infinity
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths={self.state}
InaccessiblePaths=-/etc/globaldroptrade/fresh-zero-automation.key -/etc/globaldroptrade/migration-deployer.key
''')
        smart = self.p('/var/lib/globaldroptrade/smart-worker-v1')
        safe_directory(smart, mode=0o700, create=True)
        self.write_managed(units/COORDINATOR, f'''[Unit]
Description=Global ordered index and funded payment coordinator
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=root
UMask=0077
ExecStart=/usr/bin/python3 {worker}/scripts/smart-worker.py
TimeoutStartSec=infinity
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths={smart}
InaccessiblePaths=-/etc/globaldroptrade/fresh-zero-automation.key -/etc/globaldroptrade/migration-deployer.key
''')
        self.write_managed(units/'globaldroptrade-smart-worker.timer', '''[Unit]
Description=Continue ordered Global indexing and reward credits
[Timer]
OnBootSec=20s
OnUnitInactiveSec=20s
AccuracySec=2s
Unit=globaldroptrade-smart-worker.service
[Install]
WantedBy=timers.target
''')
        if self.states[FAILOVER]['loaded']:
            self.write_managed(units/FAILOVER, f'''[Unit]
Description=Verified Global testnet RPC failover using the matching release
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=root
UMask=0077
WorkingDirectory={self.failover_release}
ExecStart=/usr/bin/python3 {self.failover_release}/scripts/zero-rpc-failover.py
TimeoutStartSec=infinity
''')

    def install_configuration(self, stage, report):
        self.announce('SWITCHING_VERIFIED_RELEASE')
        if digest(safe_file(self.envfile, private=True)) != report['originalEnvSha256'] or digest(safe_file(self.state/'daily-policy.json', private=True)) != report['dailyPolicySha256']:
            raise InstallError('CONFIGURATION_CHANGED_DURING_RELEASE')
        existing_activity = safe_file(self.activity_policy, private=True, optional=True)
        if (digest(existing_activity) if existing_activity is not None else None) != report['originalActivityPolicySha256']:
            raise InstallError('ACTIVITY_POLICY_CHANGED_DURING_RELEASE')
        if digest(safe_file(self.state/'journal.json', private=True)) != report['originalJournalSha256']:
            raise InstallError('FINANCIAL_JOURNAL_CHANGED_DURING_RELEASE')
        # Financial state is copied for forensic comparison only, never placed
        # in the rollback manifest and never restored by this installer.
        atomic_file(self.backup/'financial-journal-before.json', safe_file(self.state/'journal.json', private=True))
        atomic_file(self.backup/'daily-policy-before.json', safe_file(self.state/'daily-policy.json', private=True))
        self.journal_before = digest(safe_file(self.state/'journal.json', private=True))
        api_state = self.p('/var/lib/globaldroptrade-api')
        safe_directory(api_state, mode=0o700, create=True, uid=self.api_user.pw_uid, gid=self.api_user.pw_gid)
        # Activity history is created/validated by the API under its own UID.
        # An existing history file is not copied, truncated, chmodded or restored.
        self.write_managed(self.envfile, safe_file(stage/'trades.env', private=True), mode=0o600)
        if existing_activity is None:
            self.write_managed(self.activity_policy, safe_file(stage/'daily-activity-policy.json', private=True), mode=0o600)
        public = safe_directory(self.p('/var/www/globaldroptrade/automation-data'), create=True)
        public_status = public/'activation.json'
        if not public_status.exists():
            initial = {'version':1, 'kind':'fresh-zero-automation-error', 'chainId':97,
                       'target':TARGET, 'ready':False, 'dailyAutomationActive':False,
                       'automationStatus':'waiting', 'blockers':['FIRST_UPDATED_WORKER_CYCLE_REQUIRED'],
                       'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
            self.write_managed(public_status, json.dumps(initial)+'\n')
        else:
            safe_file(public_status)
        for base, target in (('/opt/globaldroptrade-zero-daily', self.release), ('/opt/globaldroptrade-api', self.api_release)):
            link = self.p(base)/'current'
            self.snapshot(link)
            self.changed = True
            atomic_link(link, target)
        self.unit_files()
        pattern = r'(?m)(\broot\s+)'+re.escape(self.old_web_declared)+r'(\s*;)'
        replacement, count = re.subn(pattern, lambda match:match.group(1)+self.new_web_declared+match.group(2), self.old_conf)
        if count < 1:
            raise InstallError('MANAGED_NGINX_ROOT_NOT_FOUND')
        self.write_managed(self.conf, replacement)
        self.system.run(['nginx', '-t'])
        self.system.control('daemon-reload')
        effective = self.system.value(PAYMENT, 'ExecStart')
        if '--indexed-payments' not in effective or str(self.p('/opt/globaldroptrade-zero-daily/current/scripts/zero-start-automation.mjs')) not in effective:
            raise InstallError('EFFECTIVE_PAYMENT_COMMAND_MISMATCH')
        self.system.control('restart', API)
        self.system.control('reload', 'nginx')

    def verify_http(self, report):
        self.announce('VERIFYING_LIVE_ROUTES')
        failures = None
        for attempt in range(5):
            try:
                code, body = self.system.fetch('/api/health')
                value = json.loads(body)
                if code != 200 or value.get('status') != 'ok' or value.get('configured') is not True:
                    raise InstallError('API_NOT_READY')
                code, body = self.system.fetch('/api/config')
                cfg = json.loads(body)
                if code != 200 or cfg.get('chainId') != 97 or str(cfg.get('vaultAddress', '')).lower() != TARGET.lower():
                    raise InstallError('LIVE_TARGET_MISMATCH')
                code, body = self.system.fetch('/api/trades?limit=1')
                trades = json.loads(body)
                if code != 200 or trades.get('status') != 'live' or trades.get('chainId') != 97 or str(trades.get('contract', '')).lower() != TARGET.lower():
                    raise InstallError('LIVE_CONTRACT_FEED_NOT_READY')
                code, body = self.system.fetch('/?daily_release='+self.revision)
                if code != 200 or body.encode() != (self.new_web/'index.html').read_bytes():
                    raise InstallError('LIVE_FRONTEND_RELEASE_MISMATCH')
                for route in ('/automation-data/activation.json', '/deploy/zero-start-activation.json', '/api/automation/status'):
                    code, body = self.system.fetch(route)
                    status_report = json.loads(body)
                    if code not in (200, 503) or not isinstance(status_report, dict):
                        raise InstallError('PUBLIC_STATUS_JSON_REQUIRED')
                code, body = self.system.fetch('/api/daily-activity/status?wallet='+TARGET)
                activity = json.loads(body)
                if (code != 200 or not isinstance(activity, dict) or activity.get('chainId') != 97 or
                        str(activity.get('vaultAddress', '')).lower() != TARGET.lower() or
                        activity.get('requirementEnabled') is not True or
                        activity.get('windowSeconds') != 86400 or
                        activity.get('activationTimestamp') != report['activityPolicy']['activationTimestamp']):
                    raise InstallError('ACTIVITY_API_NOT_READY')
                return
            except (InstallError, ValueError) as error:
                failures = error
                if attempt < 4:
                    self.sleep(2)
        raise InstallError(str(failures) if isinstance(failures, InstallError) else 'LIVE_JSON_HEALTH_FAILED')

    def restore_snapshots(self):
        for name, entry in reversed(list(self.snapshots.items())):
            file = self.p(name)
            if entry['kind'] == 'absent':
                if file.is_symlink() or file.is_file():
                    file.unlink()
            elif entry['kind'] == 'link':
                atomic_link(file, entry['target'])
            elif entry['kind'] == 'file':
                atomic_file(file, base64.b64decode(entry['data'], validate=True), entry['mode'])
            else:
                raise InstallError('BACKUP_ENTRY_INVALID')

    def restore_timers(self):
        for timer in TIMERS:
            previous = self.states.get(timer, {})
            if previous.get('loaded'):
                if previous.get('enabled') == 'enabled':
                    self.system.control('enable', timer)
                elif previous.get('enabled') == 'enabled-runtime':
                    self.system.run(['systemctl', 'enable', '--runtime', timer])
                elif previous.get('enabled') == 'disabled':
                    self.system.control('disable', timer)
            if previous.get('loaded') and previous.get('active') in BUSY:
                self.system.control('start', timer)

    def rollback(self):
        if self.payments_may_have_started:
            # Never switch a source underneath a newly signed transaction.
            for timer in TIMERS:
                if self.system.value(timer, 'LoadState') == 'loaded':
                    self.system.control('stop', timer)
            print('RELEASE_INSTALLED_SCHEDULING_REVIEW_REQUIRED backup='+str(self.backup), flush=True)
            return
        if self.changed:
            # Apply's context has released these locks after an exception. A
            # manual service start must not race a source-pointer restoration.
            with ExitStack() as locks:
                for name in FINANCIAL_LOCKS:
                    locks.enter_context(self.lock(self.p(name)))
                self.restore_snapshots()
                self.system.control('daemon-reload')
                self.system.run(['nginx', '-t'])
                self.system.control('restart', API)
                self.system.control('reload', 'nginx')
        self.restore_timers()
        print('PREVIOUS_RELEASE_RESTORED financialJournalRestored=false', flush=True)

    def apply(self):
        self.inspect()
        self.preflight()
        # This lock serializes other managed release installers, not payments.
        with self.lock(self.p('/var/lib/globaldroptrade/worker-sync-v1/run.lock')):
            self.stage_release()
            try:
                self.quiesce()
                with ExitStack() as locks:
                    for name in FINANCIAL_LOCKS:
                        locks.enter_context(self.lock(self.p(name)))
                    stage = self.backup/'configuration-stage'
                    stage.mkdir(mode=0o700)
                    report = self.preflight(runtime=self.release, stage=stage)
                    self.install_configuration(stage, report)
                    self.verify_http(report)
                    if digest(safe_file(self.state/'journal.json', private=True)) != self.journal_before or digest(safe_file(self.state/'daily-policy.json', private=True)) != report['dailyPolicySha256']:
                        raise InstallError('FINANCIAL_STATE_CHANGED_UNDER_RELEASE_LOCK')
                    self.announce('ACTIVATING_ORDERED_SCHEDULER')
                    # Only one coordinator schedules index and payment jobs.
                    for timer in TIMERS:
                        if timer not in ('globaldroptrade-smart-worker.timer', 'globaldroptrade-rpc-failover.timer') and self.states[timer]['loaded']:
                            self.system.control('disable', timer)
                    self.save_manifest()
                self.payments_may_have_started = True
                self.system.run(['systemctl', 'enable', '--now', 'globaldroptrade-smart-worker.timer'])
                self.system.run(['systemctl', 'start', '--no-block', COORDINATOR])
                previous_rpc = self.states['globaldroptrade-rpc-failover.timer']
                if previous_rpc['loaded'] and previous_rpc['active'] in BUSY:
                    self.system.control('start', 'globaldroptrade-rpc-failover.timer')
                if self.system.value('globaldroptrade-smart-worker.timer', 'ActiveState') != 'active':
                    raise InstallError('ORDERED_SCHEDULER_NOT_ACTIVE')
                self.announce('INSTALLED')
                self.save_manifest()
                return {'installed':True, 'sourceRevision':self.revision, 'chainId':97,
                        'target':TARGET, 'backup':str(self.backup),
                        'activityActivationTimestamp':report['activityPolicy']['activationTimestamp'],
                        'periodSeconds':report['periodSeconds'], 'acceleratedTestSchedule':True,
                        'waitingFor':report.get('waitingFor', []),
                        'orderedSchedulerActive':True, 'installerSignerOpened':False,
                        'financialStateReplaced':False, 'paymentReceiptVerified':False,
                        'nextCheck':'https://globaldroptrade.com/api/automation/status'}
            except BaseException:
                try:
                    self.rollback()
                except Exception:
                    print('ROLLBACK_REQUIRES_REVIEW backup='+str(self.backup), flush=True)
                raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true', help='Read existing state and verify RPC identity without writes (default).')
    mode.add_argument('--apply', action='store_true', help='Install this reviewed release on the existing testnet server.')
    parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--expected-revision', help='Require an exact 40-character checked-out Git revision.')
    parser.add_argument('--rpc-file', type=Path, help='Optional already-owned private RPC URL file; verified before use.')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise InstallError('ROOT_REQUIRED')
    if args.expected_revision and not re.fullmatch(r'[0-9a-f]{40}', args.expected_revision):
        raise InstallError('EXACT_REVISION_REQUIRED')
    if args.apply and not args.expected_revision:
        raise InstallError('EXACT_REVISION_REQUIRED_FOR_APPLY')
    if args.rpc_file and not args.rpc_file.is_absolute():
        raise InstallError('ABSOLUTE_PRIVATE_RPC_FILE_REQUIRED')
    installer = Installer(args.source, expected_revision=args.expected_revision, rpc_file=args.rpc_file)
    if args.apply:
        report = installer.apply()
    else:
        report = installer.inspect()
        report['preflight'] = installer.preflight()
        report['readOnly'] = True
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (InstallError, OSError, ValueError, KeyError):
        error = sys.exc_info()[1]
        code = str(error) if isinstance(error, InstallError) and re.fullmatch(r'[A-Z][A-Z0-9_]+', str(error)) else 'MANAGED_RELEASE_CHECK_FAILED'
        print('GLOBAL_DAILY_RELEASE_STOPPED '+code)
        raise SystemExit(1)

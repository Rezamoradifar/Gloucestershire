#!/usr/bin/env python3
"""Find a fully verified RPC with the pinned installer, then optionally install once.

The default is read-only except for private, temporary candidate files in /run.
Each candidate must pass the existing installer's complete --check. Only a valid
RELIABILITY_VERIFIED_RPC_REQUIRED report permits another candidate. An --apply
invocation is terminal, including when its result cannot be determined.
"""
import argparse
import ast
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import types


TARGET = '0xB5c3C0f8fc30b2FDB8b16d2325127dAe7C8DCD5B'
ROOT_UID = 0  # Tests substitute the fake host's owner; the CLI requires euid 0.
CHECK_TIMEOUT = 330
MAX_OUTPUT = 1048576
PUBLIC_CANDIDATES = (
    ('onfinality-testnet', 'https://bnb-testnet.api.onfinality.io/public'),
    ('publicnode-testnet', 'https://bsc-testnet-rpc.publicnode.com'),
    ('bnb-dataseed', 'https://bsc-testnet-dataseed.bnbchain.org'),
    ('bnb-testnet', 'https://bsc-testnet.bnbchain.org'),
)
WAITING_CODES = frozenset((
    'REPORTER_AUTHORIZATION_REQUIRED', 'CONTRACT_PAUSED', 'REWARD_BUDGET_EMPTY',
    'VAULT_CASH_SHORTFALL', 'TOTAL_TEST_BNB_FEE_LIMIT_0_1', 'INSUFFICIENT_TEST_BNB'))
APPLY_PHASES = frozenset((
    'STAGING', 'WAITING_FOR_IN_FLIGHT_WORK', 'SWITCHING_VERIFIED_RELEASE',
    'VERIFYING_LIVE_ROUTES', 'ACTIVATING_ORDERED_SCHEDULER', 'INSTALLED'))
RETRY_PHASES = frozenset((
    'RPC_VERIFICATION', 'TARGET_VERIFICATION', 'CONFIRMED_CHECKPOINT',
    'HISTORICAL_SNAPSHOT', 'HISTORICAL_STATE', 'SETTLEMENT_LOGS',
    'CANONICAL_VERIFICATION', 'CURRENT_PERMISSIONS', 'CURRENT_FUNDING'))
RETRY_REASONS = frozenset((
    'TIMEOUT', 'RATE_LIMITED', 'AUTHENTICATION_REQUIRED', 'TRANSPORT_UNAVAILABLE',
    'METHOD_UNAVAILABLE', 'HISTORICAL_STATE_UNAVAILABLE', 'INVALID_RESPONSE',
    'BLOCK_RANGE_LIMIT', 'RESULT_LIMIT', 'REQUEST_BUDGET_EXCEEDED',
    'CREATION_PROOF_UNAVAILABLE'))


class RecoveryError(Exception):
    """Only fixed local codes and already-sanitized reports reach the terminal."""


def require(condition, code='RECOVERY_INSTALLER_REPORT_INVALID'):
    if not condition:
        raise RecoveryError(code)


def integer(value, minimum=0, maximum=9007199254740991):
    return type(value) is int and minimum <= value <= maximum


def safe_directory(path):
    info = Path(path).lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == ROOT_UID and
            not info.st_mode & 0o022, 'RECOVERY_DIRECTORY_UNSAFE')


def read_file(path, *, private=False, optional=False, maximum=MAX_OUTPUT):
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        if optional:
            return None
        raise RecoveryError('RECOVERY_REQUIRED_FILE_MISSING') from None
    except OSError:
        raise RecoveryError('RECOVERY_FILE_UNSAFE') from None
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == ROOT_UID and
                info.st_nlink == 1 and not info.st_mode & (0o077 if private else 0o022)
                and info.st_size <= maximum, 'RECOVERY_FILE_UNSAFE')
        data = stream.read(maximum+1)
        require(len(data) <= maximum, 'RECOVERY_FILE_UNSAFE')
        return data


def load_pinned_installer(source, revision):
    """Reuse the pinned installer's explicit diagnostic allowlists, without pycache."""
    require(re.fullmatch(r'[0-9a-f]{40}', revision) is not None, 'EXACT_REVISION_REQUIRED')
    safe_directory(source)
    safe_directory(source/'scripts')
    environment = {**os.environ, 'GIT_OPTIONAL_LOCKS':'0'}

    def git(*arguments):
        try:
            result = subprocess.run(['git', *arguments], cwd=source, env=environment,
                                    stdin=subprocess.DEVNULL, capture_output=True,
                                    timeout=30, check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise RecoveryError('RECOVERY_SOURCE_VERIFICATION_FAILED') from None
        require(result.returncode == 0, 'RECOVERY_SOURCE_VERIFICATION_FAILED')
        return result.stdout

    require(git('rev-parse', 'HEAD').decode('ascii').strip() == revision,
            'EXPECTED_SOURCE_REVISION_REQUIRED')
    installer_bytes = None
    for name in ('recover-daily-reliability.py', 'install-daily-reliability.py'):
        relative = 'scripts/'+name
        data = read_file(source/relative)
        require(data == git('show', 'HEAD:'+relative), 'RECOVERY_SOURCE_CHANGED')
        if name == 'install-daily-reliability.py':
            installer_bytes = data
    module = types.ModuleType('pinned_daily_reliability_installer')
    module.__file__ = str(source/'scripts/install-daily-reliability.py')
    exec(compile(installer_bytes, module.__file__, 'exec'), module.__dict__)
    # Only literal error codes in the exact pinned source may be reproduced.
    literal_codes = {node.args[0].value for node in ast.walk(ast.parse(installer_bytes))
                     if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                     and node.func.id == 'InstallError' and node.args
                     and isinstance(node.args[0], ast.Constant)
                     and isinstance(node.args[0].value, str)
                     and re.fullmatch(r'[A-Z][A-Z0-9_]+', node.args[0].value)}
    module.RECOVERY_FAILURE_CODES = literal_codes | module.PREFLIGHT_FAILURE_CODES
    return module


def decode_object(text):
    require(isinstance(text, str) and len(text) <= MAX_OUTPUT)

    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result)
            result[key] = value
        return result

    def invalid_constant(_):
        raise RecoveryError('RECOVERY_INSTALLER_REPORT_INVALID')

    try:
        value, end = json.JSONDecoder(object_pairs_hook=pairs,
                                     parse_constant=invalid_constant).raw_decode(text.lstrip())
    except (ValueError, RecursionError):
        raise RecoveryError('RECOVERY_INSTALLER_REPORT_INVALID') from None
    require(isinstance(value, dict))
    return value, text.lstrip()[end:].strip()


def verified_check(value, revision):
    require(value.get('version') == 1 and type(value.get('version')) is int and
            value.get('chainId') == 97 and type(value.get('chainId')) is int and
            value.get('target') == TARGET and value.get('sourceRevision') == revision and
            value.get('readOnly') is True and value.get('signerOpened') is False and
            integer(value.get('transactionsSent'), 0, 0))
    preflight = value.get('preflight')
    require(isinstance(preflight, dict))
    require(preflight.get('version') == 1 and type(preflight.get('version')) is int and
            preflight.get('kind') == 'global-daily-reliability-preflight' and
            preflight.get('chainId') == 97 and type(preflight.get('chainId')) is int and
            preflight.get('target') == TARGET and preflight.get('signerOpened') is False and
            integer(preflight.get('transactionsSent'), 0, 0) and
            integer(preflight.get('verifiedRpcCount'), 1, 4) and
            type(preflight.get('periodSeconds')) is int and preflight.get('periodSeconds') in (900, 3600) and
            preflight.get('acceleratedTestSchedule') is True)
    checkpoint, policy = preflight.get('checkpoint'), preflight.get('activityPolicy')
    require(isinstance(checkpoint, dict) and isinstance(policy, dict))
    require(integer(checkpoint.get('number'), 1) and integer(checkpoint.get('timestamp'), 1)
            and re.fullmatch(r'0x[0-9a-fA-F]{64}', str(checkpoint.get('hash'))) is not None)
    require(policy.get('version') == 1 and type(policy.get('version')) is int and
            policy.get('chainId') == 97 and type(policy.get('chainId')) is int and
            policy.get('vaultAddress') == TARGET and
            policy.get('origin') == 'https://globaldroptrade.com' and
            type(policy.get('windowSeconds')) is int and policy.get('windowSeconds') == 86400 and
            integer(policy.get('activationTimestamp'), 1) and
            policy.get('historyFile') == '/var/lib/globaldroptrade-api/daily-activity.json')
    require(isinstance(preflight.get('waitingFor'), list) and
            all(isinstance(code, str) and code in WAITING_CODES for code in preflight['waitingFor']))
    return preflight


def run_installer(command, **options):
    if '--apply' not in command:
        return subprocess.run(command, **options)
    # SIGINT must not kill an installer halfway through its rollback rules. The
    # separate process group also protects it from a terminal's group interrupt.
    options.pop('check')
    options.pop('timeout')
    options.pop('capture_output')
    child = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             start_new_session=True, **options)
    try:
        while True:
            try:
                stdout, stderr = child.communicate()
                return subprocess.CompletedProcess(command, child.returncode, stdout, stderr)
            except KeyboardInterrupt:
                print('GLOBAL_DAILY_RECOVERY applyInProgress=true waitingForInstaller=true automaticRetry=false', flush=True)
    finally:
        # Keep the private candidate alive until the only applying child exits,
        # even if its output pipe fails. Never launch a replacement child.
        while child.poll() is None:
            try:
                child.wait()
            except KeyboardInterrupt:
                continue


class Recovery:
    def __init__(self, source, revision, *, root=Path('/'), run=run_installer):
        self.source = Path(source).absolute()
        self.revision = revision
        self.root = Path(root)
        self.run_child = run
        self.protocol = None
        self.apply_attempted = False

    def invoke(self, candidate, apply=False):
        command = [sys.executable, str(self.source/'scripts/install-daily-reliability.py'),
                   '--source', str(self.source), '--expected-revision', self.revision,
                   '--apply' if apply else '--check']
        if candidate is not None:
            command += ['--rpc-file', str(candidate)]
        if apply:
            self.apply_attempted = True
        try:
            # Never kill an applying installer at an outer deadline. Its own
            # bounded commands and financial rollback rules govern the cutover.
            return self.run_child(command, cwd=self.source, stdin=subprocess.DEVNULL,
                                  capture_output=True, text=True, check=False,
                                  timeout=None if apply else CHECK_TIMEOUT)
        except (OSError, subprocess.TimeoutExpired, KeyboardInterrupt):
            code = 'RECOVERY_APPLY_RESULT_UNKNOWN_NO_RETRY' if apply else 'RECOVERY_CHECK_RESULT_UNKNOWN'
            raise RecoveryError(code) from None

    def known_stop(self, text):
        if not isinstance(text, str) or len(text) > MAX_OUTPUT:
            return None
        for line in reversed(text.splitlines()):
            prefix = 'GLOBAL_DAILY_RELEASE_STOPPED '
            if line.startswith(prefix) and line[len(prefix):] in self.protocol.RECOVERY_FAILURE_CODES:
                return line[len(prefix):]
        return None

    def check(self, label, candidate):
        print('GLOBAL_DAILY_RECOVERY checking='+label, flush=True)
        result = self.invoke(candidate)
        known = self.known_stop(result.stdout)
        if result.returncode and known and result.stdout.strip() == 'GLOBAL_DAILY_RELEASE_STOPPED '+known:
            require(known != 'RELIABILITY_VERIFIED_RPC_REQUIRED')
            raise RecoveryError(known)
        value, remainder = decode_object(result.stdout)
        if result.returncode == 0:
            require(not remainder)
            return verified_check(value, self.revision)
        require(result.returncode == 1)
        require(value.get('version') == 1 and type(value.get('version')) is int and
                value.get('kind') == 'global-daily-reliability-preflight-failure' and
                value.get('status') == 'blocked' and value.get('signerOpened') is False and
                integer(value.get('transactionsSent'), 0, 0))
        report = self.protocol.sanitize_preflight_failure(value)
        # Unknown extra fields are discarded. Every declared protocol field must
        # already be valid: sanitization must not manufacture retry eligibility.
        declared = {key:value.get(key) for key in report}
        require(json.dumps(declared, sort_keys=True) == json.dumps(report, sort_keys=True))
        require(remainder == 'GLOBAL_DAILY_RELEASE_STOPPED '+report['error'])
        print(json.dumps({'candidate':label, 'preflight':report}, indent=2), flush=True)
        if report['error'] != 'RELIABILITY_VERIFIED_RPC_REQUIRED':
            raise RecoveryError(report['error'])
        require(1 <= len(report['attempts']) <= 4 and
                all(row['verified'] is False for row in report['attempts']))
        require(all(row['phase'] in RETRY_PHASES and row['reason'] in RETRY_REASONS
                    for row in report['attempts']), 'RECOVERY_NON_AVAILABILITY_FAILURE')
        return None

    def apply_failure(self, text):
        code, phase, rollback = self.known_stop(text), None, None
        if isinstance(text, str) and len(text) <= MAX_OUTPUT:
            for line in text.splitlines():
                prefix = 'GLOBAL_DAILY_RELEASE phase='
                if line.startswith(prefix) and line[len(prefix):] in APPLY_PHASES:
                    phase = line[len(prefix):]
                if line == 'PREVIOUS_RELEASE_RESTORED financialJournalRestored=false':
                    rollback = 'PREVIOUS_RELEASE_RESTORED'
                for marker in ('RELEASE_INSTALLED_SCHEDULING_REVIEW_REQUIRED', 'ROLLBACK_REQUIRES_REVIEW'):
                    if re.fullmatch(marker+r' backup=/var/backups/globaldroptrade/daily-reliability/[0-9]{8}T[0-9]{6}-[0-9a-f]{10}', line):
                        rollback = marker
        report = {'version':1, 'kind':'global-daily-reliability-recovery-apply-failure',
                  'error':code or 'RECOVERY_APPLY_RESULT_UNKNOWN_NO_RETRY',
                  'applyAttempted':True, 'automaticRetry':False, 'lastKnownPhase':phase,
                  'rollbackStatus':rollback, 'currentTransactionState':'unknown'}
        print(json.dumps(report, indent=2), flush=True)
        return RecoveryError(report['error'])

    def apply(self, label, candidate):
        print('GLOBAL_DAILY_RECOVERY applying='+label+' automaticRetry=false', flush=True)
        result = self.invoke(candidate, apply=True)
        try:
            require(result.returncode == 0)
            require(isinstance(result.stdout, str) and len(result.stdout) <= MAX_OUTPUT)
            lines = result.stdout.splitlines()
            opening = next(index for index, line in enumerate(lines) if line.startswith('{'))
            for line in lines[:opening]:
                if not line.strip():
                    continue
                if line.startswith('GLOBAL_DAILY_RELEASE phase='):
                    require(line.removeprefix('GLOBAL_DAILY_RELEASE phase=') in APPLY_PHASES)
                else:
                    require(re.fullmatch(r'GLOBAL_DAILY_RELEASE waitingFor=[a-z0-9.,-]+', line) is not None)
            value, remainder = decode_object('\n'.join(lines[opening:]))
            require(not remainder and value.get('installed') is True and
                    value.get('sourceRevision') == self.revision and
                    value.get('chainId') == 97 and type(value.get('chainId')) is int and
                    value.get('target') == TARGET and value.get('orderedSchedulerActive') is True and
                    value.get('installerSignerOpened') is False and
                    value.get('financialStateReplaced') is False and
                    value.get('paymentReceiptVerified') is False and
                    value.get('acceleratedTestSchedule') is True and
                    type(value.get('periodSeconds')) is int and value.get('periodSeconds') in (900, 3600) and
                    integer(value.get('activityActivationTimestamp'), 1) and
                    isinstance(value.get('waitingFor'), list) and
                    all(isinstance(code, str) and code in WAITING_CODES for code in value['waitingFor']))
        except (RecoveryError, StopIteration):
            raise self.apply_failure(result.stdout) from None
        # Never forward the child output, a private path, or arbitrary new fields.
        return {key:value[key] for key in (
            'installed', 'sourceRevision', 'chainId', 'target', 'activityActivationTimestamp',
            'periodSeconds', 'acceleratedTestSchedule', 'waitingFor', 'orderedSchedulerActive',
            'installerSignerOpened', 'financialStateReplaced', 'paymentReceiptVerified')}

    def execute(self, apply=False):
        self.protocol = load_pinned_installer(self.source, self.revision)
        safe_directory(self.root/'run')
        with tempfile.TemporaryDirectory(prefix='global-daily-recovery-', dir=self.root/'run') as temporary:
            directory = Path(temporary)
            directory.chmod(0o700)
            safe_directory(directory)

            def private_candidate(label, data):
                file = directory/(label+'.rpc')
                descriptor = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(descriptor, 'wb') as stream:
                    os.fchmod(stream.fileno(), 0o600)
                    stream.write(data)
                    stream.flush()
                    os.fsync(stream.fileno())
                require(read_file(file, private=True, maximum=16385) == data, 'RECOVERY_CANDIDATE_CHANGED')
                return file

            def candidates():
                yield 'current', None, None
                managed = self.root/'etc/globaldroptrade/archive-rpc-url'
                # Snapshot the managed private file once. Check and apply receive
                # the identical snapshot, even if its original later changes.
                data = read_file(managed, private=True, optional=True, maximum=16385)
                if data is not None:
                    yield 'saved-archive', private_candidate('saved-archive', data), data
                for label, url in PUBLIC_CANDIDATES:
                    data = (url+'\n').encode('ascii')
                    yield label, private_candidate(label, data), data

            for label, candidate, original in candidates():
                preflight = self.check(label, candidate)
                if preflight is None:
                    continue
                if candidate is not None:
                    require(read_file(candidate, private=True, maximum=16385) == original,
                            'RECOVERY_CANDIDATE_CHANGED')
                if apply:
                    # Returning or raising here makes every apply result terminal.
                    result = self.apply(label, candidate)
                else:
                    result = {'readOnly':True, 'sourceRevision':self.revision,
                              'chainId':97, 'target':TARGET, 'transactionsSent':0,
                              'signerOpened':False, 'verifiedRpcCount':preflight['verifiedRpcCount'],
                              'activityActivationTimestamp':preflight['activityPolicy']['activationTimestamp'],
                              'periodSeconds':preflight['periodSeconds'],
                              'acceleratedTestSchedule':True, 'waitingFor':preflight['waitingFor']}
                return {'version':1, 'kind':'global-daily-reliability-recovery',
                        'checkedCandidateSource':label, 'applyAttempted':self.apply_attempted, **result}
        raise RecoveryError('RELIABILITY_VERIFIED_RPC_REQUIRED')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true', help='Find a fully verified candidate without installing (default).')
    mode.add_argument('--apply', action='store_true', help='Apply once after a candidate passes every installer check.')
    parser.add_argument('--expected-revision', required=True, help='Exact 40-character checked-out Git revision.')
    args = parser.parse_args()
    require(os.geteuid() == 0, 'ROOT_REQUIRED')
    recovery = Recovery(Path(__file__).resolve().parents[1], args.expected_revision)
    print(json.dumps(recovery.execute(apply=args.apply), indent=2))


if __name__ == '__main__':
    try:
        main()
    except (RecoveryError, OSError, ValueError, KeyboardInterrupt) as error:
        # External exception messages can contain private paths and RPC secrets.
        code = str(error) if isinstance(error, RecoveryError) else 'RECOVERY_STOPPED_REVIEW_REQUIRED'
        print('GLOBAL_DAILY_RECOVERY_STOPPED '+code)
        raise SystemExit(1)

"""Verify bounded RPC recovery, private files, and a single terminal installation."""
from contextlib import redirect_stdout
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch


REPO = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('daily_recovery', REPO/'scripts/recover-daily-reliability.py')
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)
SECRET = 'PRIVATE_ARCHIVE_KEY_MUST_NOT_LEAK'
PRIVATE_RPC = ('https://archive.invalid/'+SECRET+'\n').encode()


def completed(stdout, code=0):
    return types.SimpleNamespace(returncode=code, stdout=stdout, stderr='private stderr '+SECRET)


def blocked(code='RELIABILITY_VERIFIED_RPC_REQUIRED', reason='TIMEOUT', phase='TARGET_VERIFICATION'):
    diagnostic = {'phase':phase, 'operation':'verify-target', 'reason':reason,
                  'errorCode':'TIMEOUT', 'rpcCode':None, 'httpStatus':None,
                  'block':None, 'requestedTimestamp':None}
    value = {'version':1, 'kind':'global-daily-reliability-preflight-failure',
             'status':'blocked', 'error':code, **diagnostic,
             'attempts':[{'candidate':0, 'verified':False, **diagnostic}],
             'transactionsSent':0, 'signerOpened':False}
    return completed(json.dumps(value, indent=2)+'\nGLOBAL_DAILY_RELEASE_STOPPED '+code+'\n', 1)


def checked(revision):
    preflight = {
        'version':1, 'kind':'global-daily-reliability-preflight', 'chainId':97,
        'target':M.TARGET, 'verifiedRpcCount':1, 'periodSeconds':900,
        'acceleratedTestSchedule':True, 'transactionsSent':0, 'signerOpened':False,
        'checkpoint':{'number':42000, 'timestamp':1900000000, 'hash':'0x'+'ab'*32},
        'waitingFor':['REWARD_BUDGET_EMPTY'],
        'activityPolicy':{'version':1, 'chainId':97, 'vaultAddress':M.TARGET,
                          'origin':'https://globaldroptrade.com', 'windowSeconds':86400,
                          'activationTimestamp':1900086400,
                          'historyFile':'/var/lib/globaldroptrade-api/daily-activity.json'},
    }
    return {'version':1, 'chainId':97, 'target':M.TARGET, 'sourceRevision':revision,
            'readOnly':True, 'transactionsSent':0, 'signerOpened':False,
            'preflight':preflight}


def installed(revision):
    value = {'installed':True, 'sourceRevision':revision, 'chainId':97, 'target':M.TARGET,
             'activityActivationTimestamp':1900086400, 'periodSeconds':900,
             'acceleratedTestSchedule':True, 'waitingFor':['REWARD_BUDGET_EMPTY'],
             'orderedSchedulerActive':True, 'installerSignerOpened':False,
             'financialStateReplaced':False, 'paymentReceiptVerified':False,
             'privateExtra':SECRET}
    return completed('GLOBAL_DAILY_RELEASE phase=STAGING\n'
                     'GLOBAL_DAILY_RELEASE waitingFor=globaldroptrade-zero-daily.service\n'
                     'GLOBAL_DAILY_RELEASE phase=INSTALLED\n'+json.dumps(value, indent=2)+'\n')


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        base = Path(temporary.name)
        self.root, self.source = base/'host', base/'source'
        (self.root/'run').mkdir(parents=True)
        (self.root/'etc/globaldroptrade').mkdir(parents=True)
        (self.source/'scripts').mkdir(parents=True)
        for name in ('recover-daily-reliability.py', 'install-daily-reliability.py'):
            shutil.copyfile(REPO/'scripts'/name, self.source/'scripts'/name)
        for command in (['git', 'init', '-q'], ['git', 'add', 'scripts'],
                        ['git', '-c', 'user.name=Recovery Test', '-c', 'user.email=test@example.invalid',
                         '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null',
                         'commit', '-qm', 'Pinned recovery fixture']):
            subprocess.run(command, cwd=self.source, check=True, capture_output=True)
        self.revision = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=self.source,
                                       check=True, capture_output=True, text=True).stdout.strip()
        self.owner_patch = patch.object(M, 'ROOT_UID', os.getuid())
        self.owner_patch.start()
        self.addCleanup(self.owner_patch.stop)
        self.managed = self.root/'etc/globaldroptrade/archive-rpc-url'
        self.live = []
        for name, value in (('trades.env', b'PRIVATE_CONFIG=unchanged\n'),
                            ('journal.json', b'{"financial":"unchanged"}\n'),
                            ('daily-activity.json', b'{"activity":"unchanged"}\n')):
            file = self.root/'etc/globaldroptrade'/name
            file.write_bytes(value)
            file.chmod(0o600)
            self.live.append((file, value))
        self.output, self.calls, self.snapshots = io.StringIO(), [], []

    def save_managed(self):
        self.managed.write_bytes(PRIVATE_RPC)
        self.managed.chmod(0o600)

    def success(self):
        return completed(json.dumps(checked(self.revision), indent=2))

    def runner(self, responses, inspect=None):
        remaining = iter(responses)

        def run(command, **options):
            self.calls.append((command, options))
            self.assertEqual(command[:2], [sys.executable, str(self.source/'scripts/install-daily-reliability.py')])
            self.assertIn(self.revision, command)
            self.assertFalse(any('https://' in argument or SECRET in argument for argument in command))
            self.assertEqual(options['stdin'], subprocess.DEVNULL)
            self.assertEqual(options['timeout'], None if '--apply' in command else M.CHECK_TIMEOUT)
            candidate = None
            if '--rpc-file' in command:
                candidate = Path(command[command.index('--rpc-file')+1])
                self.assertTrue(candidate.is_relative_to(self.root/'run'))
                info = candidate.lstat()
                self.assertEqual(info.st_uid, os.getuid())
                self.assertEqual(stat.S_IMODE(info.st_mode), 0o600)
                self.assertEqual(stat.S_IMODE(candidate.parent.stat().st_mode), 0o700)
                self.snapshots.append((candidate, candidate.read_bytes()))
            if inspect:
                inspect(command, candidate)
            response = next(remaining)
            if isinstance(response, BaseException):
                raise response
            return response
        return run

    def recovery(self, responses, inspect=None, revision=None):
        return M.Recovery(self.source, revision or self.revision, root=self.root,
                          run=self.runner(responses, inspect))

    def assert_clean(self):
        self.assertEqual(list((self.root/'run').iterdir()), [])
        for file, value in self.live:
            self.assertEqual(file.read_bytes(), value)
        self.assertNotIn(SECRET, self.output.getvalue())
        for _, url in M.PUBLIC_CANDIDATES:
            self.assertNotIn(url, self.output.getvalue())

    def test_current_success_is_read_only_and_never_reads_optional_file(self):
        self.managed.symlink_to(self.root/'missing')
        with redirect_stdout(self.output):
            report = self.recovery([self.success()]).execute()
        self.assertEqual(report['checkedCandidateSource'], 'current')
        self.assertFalse(report['applyAttempted'])
        self.assertTrue(report['readOnly'])
        self.assertEqual(len(self.calls), 1)
        self.assertNotIn('--rpc-file', self.calls[0][0])
        self.assert_clean()

    def test_timeout_diagnostic_then_managed_success_uses_private_snapshot(self):
        self.save_managed()
        with redirect_stdout(self.output):
            report = self.recovery([blocked(), self.success()]).execute()
        self.assertEqual(report['checkedCandidateSource'], 'saved-archive')
        self.assertEqual(self.managed.read_bytes(), PRIVATE_RPC)
        self.assertEqual(self.snapshots[0][1], PRIVATE_RPC)
        self.assertNotEqual(self.snapshots[0][0], self.managed)
        self.assertIn('"reason": "TIMEOUT"', self.output.getvalue())
        self.assertTrue(all('--check' in command for command, _ in self.calls))
        self.assert_clean()

    def test_managed_failure_then_public_success_applies_exactly_once(self):
        self.save_managed()
        with redirect_stdout(self.output):
            report = self.recovery([blocked(), blocked(), self.success(), installed(self.revision)]).execute(apply=True)
        self.assertEqual(report['checkedCandidateSource'], 'onfinality-testnet')
        self.assertTrue(report['applyAttempted'])
        self.assertFalse(report['paymentReceiptVerified'])
        self.assertEqual(report['waitingFor'], ['REWARD_BUDGET_EMPTY'])
        self.assertEqual(sum('--apply' in command for command, _ in self.calls), 1)
        self.assertEqual(self.snapshots[-2], self.snapshots[-1])
        self.assertEqual(self.snapshots[-1][1], (M.PUBLIC_CANDIDATES[0][1]+'\n').encode())
        self.assertNotIn('privateExtra', report)
        self.assert_clean()

    def test_missing_managed_file_goes_to_first_public_candidate(self):
        with redirect_stdout(self.output):
            report = self.recovery([blocked(), self.success()]).execute()
        self.assertEqual(report['checkedCandidateSource'], 'onfinality-testnet')
        self.assertEqual(len(self.calls), 2)
        self.assert_clean()

    def test_all_candidates_unavailable_never_apply_or_change_live_files(self):
        self.save_managed()
        recovery = self.recovery([blocked()]*(2+len(M.PUBLIC_CANDIDATES)))
        with redirect_stdout(self.output), self.assertRaisesRegex(M.RecoveryError, '^RELIABILITY_VERIFIED_RPC_REQUIRED$'):
            recovery.execute(apply=True)
        self.assertFalse(recovery.apply_attempted)
        self.assertEqual(len(self.calls), 6)
        self.assertEqual(self.managed.read_bytes(), PRIVATE_RPC)
        self.assert_clean()

    def test_fatal_local_or_journal_failures_stop_before_other_candidates(self):
        for code in ('RELIABILITY_FINANCIAL_JOURNAL_INVALID', 'RELIABILITY_JOURNAL_IDENTITY_MISMATCH',
                     'RELIABILITY_ACTIVITY_POLICY_MISMATCH', 'RELIABILITY_RPC_CANDIDATES_REQUIRED'):
            with self.subTest(code=code):
                before = len(self.calls)
                with redirect_stdout(self.output), self.assertRaisesRegex(M.RecoveryError, '^'+code+'$'):
                    self.recovery([blocked(code=code), self.success()]).execute(apply=True)
                self.assertEqual(len(self.calls), before+1)
                self.assert_clean()

    def test_rpc_required_containing_local_identity_or_canonical_failure_is_terminal(self):
        for reason in ('INVALID_LOCAL_CONFIGURATION', 'FINANCIAL_JOURNAL_INVALID',
                       'CHAIN_IDENTITY_MISMATCH', 'TARGET_IDENTITY_MISMATCH', 'CANONICAL_MISMATCH'):
            with self.subTest(reason=reason):
                before = len(self.calls)
                with redirect_stdout(self.output), self.assertRaisesRegex(M.RecoveryError, '^RECOVERY_NON_AVAILABILITY_FAILURE$'):
                    self.recovery([blocked(reason=reason), self.success()]).execute(apply=True)
                self.assertEqual(len(self.calls), before+1)
                self.assert_clean()

    def test_plain_known_local_error_is_preserved_but_plain_rpc_error_never_retries(self):
        for code, expected in (('MANAGED_FILE_UNSAFE', 'MANAGED_FILE_UNSAFE'),
                               ('RELIABILITY_VERIFIED_RPC_REQUIRED', 'RECOVERY_INSTALLER_REPORT_INVALID')):
            with self.subTest(code=code):
                before = len(self.calls)
                result = completed('GLOBAL_DAILY_RELEASE_STOPPED '+code+'\n', 1)
                with redirect_stdout(self.output), self.assertRaisesRegex(M.RecoveryError, '^'+expected+'$'):
                    self.recovery([result, self.success()]).execute(apply=True)
                self.assertEqual(len(self.calls), before+1)
                self.assert_clean()

    def test_invalid_check_protocol_never_creates_retry_eligibility(self):
        failure = blocked()
        values = [completed('not-json '+SECRET, 1), completed('{}', 1),
                  completed(failure.stdout, 0), completed(failure.stdout, -9),
                  completed(failure.stdout.replace('"signerOpened": false', '"signerOpened": true'), 1),
                  completed(failure.stdout.replace('"attempts": [', '"attempts": [null,'), 1),
                  completed(failure.stdout.replace('"reason": "TIMEOUT"', '"reason": "'+SECRET+'"'), 1),
                  completed('{"version":1,"version":1}', 0),
                  completed('x'*(M.MAX_OUTPUT+1), 1)]
        for result in values:
            with self.subTest(result_length=len(result.stdout)):
                before = len(self.calls)
                with redirect_stdout(self.output), self.assertRaises(M.RecoveryError):
                    self.recovery([result, self.success()]).execute(apply=True)
                self.assertEqual(len(self.calls), before+1)
                self.assert_clean()

    def test_invalid_success_identity_or_incomplete_metadata_cannot_authorize_apply(self):
        changes = [(('sourceRevision',), 'b0'*20), (('chainId',), 56), (('readOnly',), False),
                   (('preflight', 'signerOpened'), True), (('preflight', 'verifiedRpcCount'), 0),
                   (('preflight', 'periodSeconds'), 900.0),
                   (('preflight', 'activityPolicy', 'windowSeconds'), 86400.0),
                   (('preflight', 'activityPolicy', 'vaultAddress'), '0x'+'12'*20)]
        for keys, replacement in changes:
            with self.subTest(keys=keys):
                value = copy.deepcopy(checked(self.revision))
                target = value
                for key in keys[:-1]:
                    target = target[key]
                target[keys[-1]] = replacement
                before = len(self.calls)
                with redirect_stdout(self.output), self.assertRaises(M.RecoveryError):
                    self.recovery([completed(json.dumps(value)), installed(self.revision)]).execute(apply=True)
                self.assertEqual(len(self.calls), before+1)
                self.assert_clean()

    def test_outer_check_timeout_is_terminal_unlike_a_verified_timeout_diagnostic(self):
        error = subprocess.TimeoutExpired(['hidden'], 330, output=SECRET, stderr=SECRET)
        with redirect_stdout(self.output), self.assertRaisesRegex(M.RecoveryError, '^RECOVERY_CHECK_RESULT_UNKNOWN$'):
            self.recovery([error, self.success()]).execute(apply=True)
        self.assertEqual(len(self.calls), 1)
        self.assert_clean()

    def test_apply_failure_preserves_safe_review_state_without_retry(self):
        stdout = ('GLOBAL_DAILY_RELEASE phase=ACTIVATING_ORDERED_SCHEDULER\n'
                  'RELEASE_INSTALLED_SCHEDULING_REVIEW_REQUIRED backup=/var/backups/globaldroptrade/daily-reliability/20261107T120000-0123456789\n'
                  'GLOBAL_DAILY_RELEASE_STOPPED ORDERED_SCHEDULER_NOT_ACTIVE\n')
        recovery = self.recovery([blocked(), self.success(), completed(stdout, 1), self.success()])
        with redirect_stdout(self.output), self.assertRaisesRegex(M.RecoveryError, '^ORDERED_SCHEDULER_NOT_ACTIVE$'):
            recovery.execute(apply=True)
        self.assertTrue(recovery.apply_attempted)
        self.assertEqual(len(self.calls), 3)
        self.assertIn('"lastKnownPhase": "ACTIVATING_ORDERED_SCHEDULER"', self.output.getvalue())
        self.assertIn('"rollbackStatus": "RELEASE_INSTALLED_SCHEDULING_REVIEW_REQUIRED"', self.output.getvalue())
        self.assertIn('"currentTransactionState": "unknown"', self.output.getvalue())
        self.assert_clean()

    def test_every_ambiguous_apply_result_is_terminal(self):
        errors = [subprocess.TimeoutExpired(['hidden'], 3, output=SECRET), OSError(SECRET),
                  KeyboardInterrupt(), completed('{"installed":', 0),
                  completed('private output '+SECRET, -9), completed('{}', 0)]
        for error in errors:
            with self.subTest(error_type=type(error).__name__):
                before = len(self.calls)
                recovery = self.recovery([blocked(), self.success(), error, self.success()])
                with redirect_stdout(self.output), self.assertRaisesRegex(M.RecoveryError, '^RECOVERY_APPLY_RESULT_UNKNOWN_NO_RETRY$'):
                    recovery.execute(apply=True)
                self.assertTrue(recovery.apply_attempted)
                self.assertEqual(len(self.calls), before+3)
                self.assertEqual(sum('--apply' in command for command, _ in self.calls[before:]), 1)
                self.assert_clean()

    def test_managed_original_changes_do_not_change_the_checked_apply_snapshot(self):
        self.save_managed()

        def inspect(command, candidate):
            if candidate and '--check' in command:
                self.managed.write_bytes(b'https://changed.invalid/another-secret\n')
        with redirect_stdout(self.output):
            report = self.recovery([blocked(), self.success(), installed(self.revision)], inspect).execute(apply=True)
        self.assertTrue(report['installed'])
        self.assertEqual(self.snapshots[0], self.snapshots[1])
        self.assertEqual(self.snapshots[1][1], PRIVATE_RPC)
        self.assert_clean()

    def test_unsafe_managed_file_stops_and_does_not_try_public_candidates(self):
        self.save_managed()
        self.managed.chmod(0o644)
        with redirect_stdout(self.output), self.assertRaisesRegex(M.RecoveryError, '^RECOVERY_FILE_UNSAFE$'):
            self.recovery([blocked(), self.success()]).execute(apply=True)
        self.assertEqual(len(self.calls), 1)
        self.managed.unlink()
        target = self.root/'etc/globaldroptrade/trades.env'
        self.managed.symlink_to(target)
        with redirect_stdout(self.output), self.assertRaisesRegex(M.RecoveryError, '^RECOVERY_FILE_UNSAFE$'):
            self.recovery([blocked(), self.success()]).execute(apply=True)
        self.assertEqual(len(self.calls), 2)
        self.assert_clean()

    def test_private_input_owner_and_hard_links_are_rejected(self):
        self.save_managed()
        info = self.managed.stat()
        foreign = types.SimpleNamespace(st_mode=info.st_mode, st_uid=os.getuid()+1,
                                        st_nlink=1, st_size=info.st_size)
        with patch.object(M.os, 'fstat', return_value=foreign), self.assertRaisesRegex(M.RecoveryError, '^RECOVERY_FILE_UNSAFE$'):
            M.read_file(self.managed, private=True)
        os.link(self.managed, self.managed.with_name('archive-link'))
        with self.assertRaisesRegex(M.RecoveryError, '^RECOVERY_FILE_UNSAFE$'):
            M.read_file(self.managed, private=True)
        self.assertEqual(self.managed.read_bytes(), PRIVATE_RPC)
        self.assert_clean()

    def test_revision_and_installer_bytes_are_verified_before_any_probe(self):
        for revision in ('short', 'b0'*20):
            with redirect_stdout(self.output), self.assertRaises(M.RecoveryError):
                self.recovery([], revision=revision).execute()
        installer = self.source/'scripts/install-daily-reliability.py'
        installer.write_text(installer.read_text()+'\n# Uncommitted source\n')
        with redirect_stdout(self.output), self.assertRaisesRegex(M.RecoveryError, '^RECOVERY_SOURCE_CHANGED$'):
            self.recovery([]).execute()
        self.assertEqual(self.calls, [])
        self.assert_clean()

    def test_cli_requires_root_and_an_explicit_exact_revision(self):
        with patch.object(sys, 'argv', ['recovery', '--expected-revision', self.revision]), \
                patch.object(M.os, 'geteuid', return_value=1000), self.assertRaisesRegex(M.RecoveryError, '^ROOT_REQUIRED$'):
            M.main()
        self.assertEqual(self.calls, [])

    def test_apply_interrupt_waits_for_the_same_isolated_child_without_killing_it(self):
        child = Mock()
        child.communicate.side_effect = [KeyboardInterrupt(), ('observed completion', '')]
        child.returncode = 0
        child.poll.return_value = 0
        with redirect_stdout(self.output), patch.object(M.subprocess, 'Popen', return_value=child) as popen:
            result = M.run_installer(['python3', 'installer.py', '--apply'], cwd=self.source,
                                    stdin=subprocess.DEVNULL, capture_output=True, text=True,
                                    check=False, timeout=None)
        self.assertEqual(result.stdout, 'observed completion')
        self.assertEqual(popen.call_count, 1)
        self.assertTrue(popen.call_args.kwargs['start_new_session'])
        self.assertEqual(child.communicate.call_count, 2)
        child.kill.assert_not_called()
        child.terminate.assert_not_called()
        self.assert_clean()


if __name__ == '__main__':
    unittest.main()

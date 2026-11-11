#!/usr/bin/env python3
import importlib.util
import subprocess
import unittest
from datetime import datetime, timezone
from pathlib import Path

spec = importlib.util.spec_from_file_location('index_wait', Path(__file__).with_name('install-index-when-ready.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
NOW = 1794400000


def report(*, age=0, status='ready', blockers=None, **overrides):
    value = {'chainId': 97, 'vaultAddress': module.TARGET, 'checkedAt': datetime.fromtimestamp(NOW-age, timezone.utc).isoformat(),
             'fresh': True, 'schedulerActive': True, 'dailyStatus': status, 'blockers': blockers if blockers is not None else []}
    value.update(overrides)
    return value


class Clock:
    def __init__(self): self.t = 0
    def now(self): return self.t
    def sleep(self, duration): self.t += duration


class WaitTests(unittest.TestCase):
    def run_sequence(self, reports, stage=None, max_wait=60):
        clock, calls = Clock(), []
        queue = list(reports)
        def read(_): return queue.pop(0) if len(queue) > 1 else queue[0]
        def run(mode):
            calls.append(mode)
            if stage: stage(mode)
        module.run_when_ready(read, run, wall=lambda: NOW, clock=clock.now,
                              sleep=clock.sleep, max_wait=max_wait, interval=10)
        return calls, clock.t

    def test_stale_then_ready_executes_each_phase_once(self):
        calls, elapsed = self.run_sequence([report(age=500), report()])
        self.assertEqual(calls, ['--check', '--execute'])
        self.assertEqual(elapsed, 10)

    def test_indexing_then_ready_executes_once(self):
        calls, _ = self.run_sequence([report(status='indexing', blockers=['DAILY_MEMBER_INDEX_INCOMPLETE']), report()])
        self.assertEqual(calls, ['--check', '--execute'])

    def test_target_mismatch_stops_before_installer(self):
        calls = []
        with self.assertRaisesRegex(RuntimeError, 'TARGET_MISMATCH'):
            module.run_when_ready(lambda _: report(chainId=56), calls.append, wall=lambda: NOW)
        self.assertEqual(calls, [])

    def test_future_or_stale_status_cannot_trigger(self):
        for age in (-31, 121):
            self.assertEqual(module.status_state(report(age=age), NOW), 'wait')
        self.assertEqual(module.status_state(report(checkedAt='bad'), NOW), 'wait')
        self.assertEqual(module.status_state(report(checkedAt='2026-01-01T00:00:00'), NOW), 'wait')

    def test_scheduler_and_other_blockers_stop(self):
        with self.assertRaisesRegex(RuntimeError, 'SCHEDULER_INACTIVE'):
            module.status_state(report(schedulerActive=False), NOW)
        with self.assertRaisesRegex(RuntimeError, 'OTHER_BLOCKER'):
            module.status_state(report(blockers=['SOME_OTHER_BLOCKER']), NOW)

    def test_not_ready_until_deadline_never_installs(self):
        clock, calls = Clock(), []
        with self.assertRaisesRegex(RuntimeError, 'TIMEOUT_NO_INSTALL'):
            module.run_when_ready(lambda _: report(status='indexing', blockers=['DAILY_MEMBER_INDEX_INCOMPLETE']), calls.append,
                                  wall=lambda: NOW, clock=clock.now, sleep=clock.sleep, max_wait=30, interval=10)
        self.assertEqual(clock.t, 30)
        self.assertEqual(calls, [])

    def test_response_after_deadline_never_installs(self):
        clock, calls = Clock(), []
        def slow(_): clock.t += 31; return report()
        with self.assertRaisesRegex(RuntimeError, 'TIMEOUT_NO_INSTALL'):
            module.run_when_ready(slow, calls.append, wall=lambda: NOW, clock=clock.now, sleep=clock.sleep, max_wait=30, interval=10)
        self.assertEqual(calls, [])

    def test_check_failure_does_not_execute(self):
        clock, calls = Clock(), []
        def stage(mode): calls.append(mode); raise subprocess.CalledProcessError(1, mode)
        with self.assertRaises(subprocess.CalledProcessError):
            module.run_when_ready(lambda _: report(), stage, wall=lambda: NOW, clock=clock.now, sleep=clock.sleep)
        self.assertEqual(calls, ['--check'])

    def test_execute_failure_is_not_retried(self):
        clock, calls = Clock(), []
        def stage(mode):
            calls.append(mode)
            if mode == '--execute': raise subprocess.CalledProcessError(1, mode)
        with self.assertRaises(subprocess.CalledProcessError):
            module.run_when_ready(lambda _: report(), stage, wall=lambda: NOW, clock=clock.now, sleep=clock.sleep)
        self.assertEqual(calls, ['--check', '--execute'])

    def test_status_changed_after_check_does_not_execute(self):
        clock, calls = Clock(), []
        queue = [report(), report(status='indexing', blockers=['DAILY_MEMBER_INDEX_INCOMPLETE'])]
        with self.assertRaisesRegex(RuntimeError, 'STATUS_CHANGED_NO_INSTALL'):
            module.run_when_ready(lambda _: queue.pop(0), calls.append, wall=lambda: NOW, clock=clock.now, sleep=clock.sleep)
        self.assertEqual(calls, ['--check'])

    def test_check_completing_after_deadline_does_not_execute(self):
        clock, calls = Clock(), []
        def stage(mode): calls.append(mode); clock.t += 31
        with self.assertRaisesRegex(RuntimeError, 'TIMEOUT_NO_INSTALL'):
            module.run_when_ready(lambda _: report(), stage, wall=lambda: NOW, clock=clock.now, sleep=clock.sleep, max_wait=30)
        self.assertEqual(calls, ['--check'])

    def test_malformed_status_waits(self):
        self.assertEqual(module.status_state(None, NOW), 'wait')
        self.assertEqual(module.status_state(report(blockers='bad'), NOW), 'wait')
        self.assertEqual(module.status_state(report(fresh=False), NOW), 'wait')


if __name__ == '__main__': unittest.main()

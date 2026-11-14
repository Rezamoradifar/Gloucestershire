import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parent
HISTORY = 'ee3f73ea1c3728f5a00c3fe799ca87cbfd767f3b'
FEE = 'd19bb3845f4e73517599dd1c02abbb84ac4ded4b'
TEAM = 'b53e4d25f7f89a84a1244cdbba28f10c2014c9e8'


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='v3-inode-test-')
        self.root = Path(self.temp.name)
        self.opt = self.root / 'opt'
        self.home = self.root / 'home'
        self.bin = self.root / 'bin'
        self.scripts = self.root / 'scripts'
        for directory in (self.opt, self.home, self.bin, self.scripts):
            directory.mkdir()
        self.team = self.opt / 'global-v3-team.AbC123'
        self.history = self.opt / 'global-v3-history.DeF456'
        self.fee = self.opt / 'global-v3-wallet-fee.GhI789'
        for release in (self.team, self.history, self.fee):
            (release / '.git').mkdir(parents=True)
            (release / 'website' / 'node_modules').mkdir(parents=True)
            (release / 'node_modules').mkdir()
            (release / 'website' / 'keep.txt').write_text('preserve')
        for filename, unit in (
            ('global-v3-team-unit', 'global-v3-team-1-2.service'),
            ('global-v3-history-unit', 'global-v3-history-1.service'),
            ('global-v3-wallet-fee-unit', 'global-v3-wallet-fee-1.service'),
        ):
            (self.home / filename).write_text(unit + '\n')
        script = (SCRIPTS / 'recover-v3-team-inodes.sh').read_text()
        for old, new in (
            ('/root/global-v3-team-unit', str(self.home / 'global-v3-team-unit')),
            ('/root/global-v3-history-unit', str(self.home / 'global-v3-history-unit')),
            ('/root/global-v3-wallet-fee-unit', str(self.home / 'global-v3-wallet-fee-unit')),
            ('/opt/global-v3-team', str(self.opt / 'global-v3-team')),
            ('/opt/global-v3-history', str(self.opt / 'global-v3-history')),
            ('/opt/global-v3-wallet-fee', str(self.opt / 'global-v3-wallet-fee')),
            ('/opt/global-v3-(history|wallet-fee)', str(self.opt / 'global-v3-') + '(history|wallet-fee)'),
        ):
            script = script.replace(old, new)
        (self.scripts / 'recover.sh').write_text(script)
        shutil.copyfile(SCRIPTS / 'v3-inode-process-guard.py', self.scripts / 'v3-inode-process-guard.py')
        fakes = {
            'id': 'echo 0',
            'hostname': 'echo vps-luna-2585',
            'stat': 'echo 0',
            'git': f'''case "$2" in
              *global-v3-team*) echo {TEAM};;
              *global-v3-history*) echo "${{MOCK_HISTORY_SHA:-{HISTORY}}}";;
              *global-v3-wallet-fee*) echo {FEE};;
              *) exit 1;;
            esac''',
            'systemctl': 'echo "${MOCK_STATE:-inactive}"',
            'grep': 'case "$1" in -rqsF) [ "${MOCK_REFERENCED:-0}" = 1 ] && exit 0 || exit 1;; esac; exec /usr/bin/grep "$@"',
            'journalctl': f'''case "$2" in
              global-v3-team-1-2.service) printf '%s\\n' 'npm error code ENOSPC' 'npm error path {self.team}/website/node_modules/.bin' "Failed with result 'exit-code'";;
              global-v3-history-1.service) printf '%s\\n' 'V3_HOURLY_WALLET_SITE_UPDATED=yes' 'V3_HOURLY_UPDATE_RELEASE_SHA={HISTORY}';;
              global-v3-wallet-fee-1.service) printf '%s\\n' 'V3_HOURLY_WALLET_SITE_UPDATED=yes' 'V3_HOURLY_UPDATE_RELEASE_SHA={FEE}';;
              *) echo V3_HOURLY_WALLET_SITE_UPDATED=yes;;
            esac''',
            'df': f'''case "$*" in
              *--output=iavail*)
                if [ -d '{self.history}/node_modules' ] && [ -d '{self.fee}/node_modules' ]; then echo 44355;
                elif [ -d '{self.history}/node_modules' ] || [ -d '{self.fee}/node_modules' ]; then echo 122000;
                else echo 199000; fi;;
              *--output=avail*) echo 12000000000;;
              *) echo MOCK_DF;;
            esac''',
            'systemd-run': f"touch '{self.root / 'started'}'; exit 0",
        }
        for name, body in fakes.items():
            file = self.bin / name
            file.write_text('#!/bin/sh\n' + body + '\n')
            file.chmod(0o755)

    def tearDown(self):
        self.temp.cleanup()

    def run_script(self, **kwargs):
        env = dict(os.environ, PATH=str(self.bin) + ':' + os.environ['PATH'], **kwargs)
        return subprocess.run(['bash', str(self.scripts / 'recover.sh')], env=env, text=True, capture_output=True)

    def test_only_verified_old_dependencies_are_removed_then_retry_runs(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for old in (self.history, self.fee):
            self.assertFalse((old / 'node_modules').exists())
            self.assertFalse((old / 'website' / 'node_modules').exists())
            self.assertEqual((old / 'website' / 'keep.txt').read_text(), 'preserve')
            self.assertTrue((old / '.git').is_dir())
        self.assertTrue((self.team / 'node_modules').is_dir())
        self.assertTrue((self.root / 'started').exists())

    def test_config_references_prevent_all_cleanup(self):
        result = self.run_script(MOCK_REFERENCED='1')
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertTrue((self.history / 'node_modules').exists())
        self.assertTrue((self.fee / 'node_modules').exists())
        self.assertFalse((self.root / 'started').exists())

    def test_wrong_revision_is_not_removed(self):
        result = self.run_script(MOCK_HISTORY_SHA='bad')
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertTrue((self.history / 'node_modules').exists())
        self.assertFalse((self.fee / 'node_modules').exists())
        self.assertFalse((self.root / 'started').exists())

    def test_active_previous_update_stops_everything(self):
        result = self.run_script(MOCK_STATE='active')
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertTrue((self.history / 'node_modules').exists())
        self.assertFalse((self.root / 'started').exists())


if __name__ == '__main__':
    unittest.main()

#!/usr/bin/env python3
"""Offline tests for fenced host restore and private-state integrity."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('host_restore', Path(__file__).with_name('host-restore.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def write(path, value, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.write_text(json.dumps(value) if isinstance(value, dict) else value)
    path.chmod(mode)


def fixture(base):
    base.mkdir(mode=0o700)
    stage = base/'import'; stage.mkdir(mode=0o700)
    roots = ['/etc/globaldroptrade', '/var/lib/globaldroptrade', '/var/lib/globaldroptrade-api',
             '/opt/globaldroptrade-api', '/var/www/globaldroptrade']
    for logical in roots: m.imported(stage, logical).mkdir(parents=True, mode=0o700, exist_ok=True)
    files = {
        '/etc/globaldroptrade/trades.env':'TRADES_CHAIN_ID=97\nTRADES_VAULT_ADDRESS=0x'+'12'*20+'\n',
        '/etc/globaldroptrade/operator.key':'11'*32+'\n',
        '/var/lib/globaldroptrade/worker/journal.json':{'transactions':{'saved':{'raw':'signed-bytes','block':1}}},
        '/var/lib/globaldroptrade-api/community.json':{'tickets':[]},
    }
    for logical, value in files.items(): write(m.imported(stage, logical), value)
    api = m.imported(stage, '/opt/globaldroptrade-api')
    (api/'releases/r0').mkdir(parents=True)
    write(api/'releases/r0/package.json', {'name':'test'})
    (api/'current').symlink_to('releases/r0')
    write(base/'prepared.json', {'version':1,'destinationIp':m.DESTINATION,'phase':'prepared'})
    manifest = {'version':1,'destinationIp':m.DESTINATION,'sourceId':'a'*64,
                'sourceArchitecture':'x86_64','sourceHostname':'old-test-host',
                'phase':'copied','consistent':True,'sourceFrozen':True,'paths':roots,
                'criticalHashes':{name:m.digest(m.imported(stage,name)) for name in files}}
    write(base/'transfer-manifest.json', manifest)
    return stage, manifest


class RestoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)/'migration'
        self.stage, self.manifest = fixture(self.base)

    def tearDown(self): self.temp.cleanup()

    def save_manifest(self): write(self.base/'transfer-manifest.json', self.manifest)

    def test_valid_snapshot_and_relative_api_link(self):
        manifest, stage = m.load_snapshot(self.base, 'x86_64')
        self.assertEqual(manifest['sourceId'], 'a'*64)
        self.assertEqual(m.resolve_import(stage, '/opt/globaldroptrade-api/current', manifest['paths']),
                         stage/'opt/globaldroptrade-api/releases/r0')

    def test_unfenced_or_live_stage_refused(self):
        for field, value in [('phase','staged-live'),('consistent',False),('sourceFrozen',False)]:
            original = self.manifest[field]; self.manifest[field] = value; self.save_manifest()
            with self.assertRaisesRegex(RuntimeError, 'CONSISTENT_FENCED'): m.load_snapshot(self.base, 'x86_64')
            self.manifest[field] = original

    def test_stage_check_does_not_authorize_restore(self):
        self.manifest.update(phase='staged-live', consistent=False, sourceFrozen=False, criticalHashes={})
        self.save_manifest()
        m.load_snapshot(self.base, 'x86_64', stage_check=True)
        with self.assertRaisesRegex(RuntimeError, 'CONSISTENT_FENCED'): m.load_snapshot(self.base, 'x86_64')

    def test_stage_check_never_copies_or_activates(self):
        self.manifest.update(phase='staged-live', consistent=False, sourceFrozen=False, criticalHashes={})
        self.save_manifest()
        with patch.object(m, 'BASE', self.base), patch.object(m.platform, 'machine', lambda:'x86_64'), \
             patch.object(m, 'inactive_target'), \
             patch.object(m, 'rpc_probe', lambda *args:{'chainId':97,'vaultAddress':'0x'+'12'*20}), \
             patch.object(m, 'copy_roots', side_effect=AssertionError('copied live paths')), \
             patch.object(m, 'call', side_effect=AssertionError('activated destination')):
            m.main(['--stage-check'])
        self.assertFalse((self.base/'restore-state.json').exists())

    def test_architecture_mismatch_refused(self):
        with self.assertRaisesRegex(RuntimeError, 'ARCHITECTURE_MISMATCH'): m.load_snapshot(self.base, 'aarch64')

    def test_unmanaged_roots_refused(self):
        for name in ['/root/dravon-main','/root/node_modules','/etc','/opt/globaldroptrade-host-bootstrap',
                     '/etc/systemd/system/multi-user.target.wants','/etc/letsencrypt/accounts',
                     '/root/global-fresh-reset.good/../../dravon-main']:
            self.assertFalse(m.allowed_root(name), name)

    def test_exact_global_renewal_account_root_allowed(self):
        base = '/etc/letsencrypt/accounts/acme-v02.api.letsencrypt.org/directory/'
        self.assertTrue(m.allowed_root(base+'a'*32))
        for suffix in ('', 'a'*31, '../other', 'a'*32+'/../other', 'A'*32):
            self.assertFalse(m.allowed_root(base+suffix))

    def test_referenced_account_must_be_in_snapshot(self):
        renewal = '/etc/letsencrypt/renewal/globaldroptrade.com.conf'
        self.manifest['paths'].append(renewal)
        write(m.imported(self.stage, renewal), 'version = 2\n[renewalparams]\naccount = '+'a'*32+'\n')
        self.save_manifest()
        with self.assertRaisesRegex(RuntimeError, 'REFERENCED_RENEWAL_ACCOUNT'): m.load_snapshot(self.base, 'x86_64')

    def test_scoped_renewal_account_private_key_and_hash_coverage(self):
        renewal = '/etc/letsencrypt/renewal/globaldroptrade.com.conf'
        account = '/etc/letsencrypt/accounts/acme-v02.api.letsencrypt.org/directory/'+'a'*32
        self.manifest['paths'] += [renewal, account]
        write(m.imported(self.stage, renewal), '[renewalparams]\naccount = '+'a'*32+'\n')
        for name in ('private_key.json','regr.json'):
            logical = account+'/'+name; write(m.imported(self.stage, logical), {'fixture':True})
            self.manifest['criticalHashes'][logical] = m.digest(m.imported(self.stage, logical))
        self.save_manifest(); m.load_snapshot(self.base, 'x86_64')
        del self.manifest['criticalHashes'][account+'/private_key.json']; self.save_manifest()
        with self.assertRaisesRegex(RuntimeError, 'CRITICAL_HASH_COVERAGE'):m.load_snapshot(self.base, 'x86_64')

    def test_missing_journal_hash_refused(self):
        del self.manifest['criticalHashes']['/var/lib/globaldroptrade/worker/journal.json']; self.save_manifest()
        with self.assertRaisesRegex(RuntimeError, 'CRITICAL_HASH_COVERAGE'): m.load_snapshot(self.base, 'x86_64')

    def test_changed_saved_signature_refused(self):
        write(m.imported(self.stage, '/var/lib/globaldroptrade/worker/journal.json'), {'transactions':{}})
        with self.assertRaisesRegex(RuntimeError, 'SNAPSHOT_HASH_MISMATCH'): m.load_snapshot(self.base, 'x86_64')

    def test_public_private_key_refused(self):
        m.imported(self.stage, '/etc/globaldroptrade/operator.key').chmod(0o644)
        with self.assertRaisesRegex(RuntimeError, 'PRIVATE_INPUT_REQUIRED'): m.load_snapshot(self.base, 'x86_64')

    def test_absolute_escape_refused(self):
        (self.stage/'opt/globaldroptrade-api/escape').symlink_to('/root/dravon-main')
        with self.assertRaisesRegex(RuntimeError, 'SYMLINK_ESCAPES'): m.load_snapshot(self.base, 'x86_64')

    def test_symlink_import_ancestor_refused(self):
        etc = self.stage/'etc'
        etc.rename(self.stage/'real-etc'); etc.symlink_to('real-etc')
        with self.assertRaisesRegex(RuntimeError, 'UNSAFE_IMPORT_PARENT'): m.load_snapshot(self.base, 'x86_64')

    def test_relative_certificate_link_resolves_inside_selected_roots(self):
        self.manifest['paths'] += ['/etc/letsencrypt/live/globaldroptrade.com', '/etc/letsencrypt/archive/globaldroptrade.com']
        live = self.stage/'etc/letsencrypt/live/globaldroptrade.com'; live.mkdir(parents=True)
        target = self.stage/'etc/letsencrypt/archive/globaldroptrade.com/fullchain1.pem'; write(target,'fixture')
        (live/'fullchain.pem').symlink_to('../../archive/globaldroptrade.com/fullchain1.pem')
        self.save_manifest()
        m.load_snapshot(self.base, 'x86_64')
        self.assertEqual(m.resolve_import(self.stage, '/etc/letsencrypt/live/globaldroptrade.com/fullchain.pem', self.manifest['paths']), target)

    def test_link_loop_refused(self):
        p = self.stage/'opt/globaldroptrade-api/loop'; p.symlink_to('loop')
        with self.assertRaisesRegex(RuntimeError, 'SYMLINK_LOOP'): m.load_snapshot(self.base, 'x86_64')

    def test_existing_destination_requires_same_restore_journal(self):
        path = Path(self.temp.name)/'existing'; path.mkdir()
        with patch.object(m, 'check_live_parents', lambda p:None):
            with self.assertRaisesRegex(RuntimeError, 'EXISTING_GLOBAL_PATH'): m.preflight_destinations([str(path)], {})
            m.preflight_destinations([str(path)], {'restoredPaths':[str(path)]})
            m.preflight_destinations([str(path)], {'currentPath':str(path)})

    def test_no_financial_unit_enable_calls(self):
        calls = []
        manifest = {'paths':['/etc/systemd/system/globaldroptrade-api.service',
                             '/etc/systemd/system/globaldroptrade-zero-daily.service',
                             '/etc/systemd/system/globaldroptrade-zero-daily.timer']}
        with patch.object(m, 'call', lambda args, **kw:calls.append(args)):
            m.disable_signers(manifest)
        self.assertEqual(calls, [['systemctl','disable','globaldroptrade-zero-daily.service'],
                                 ['systemctl','disable','globaldroptrade-zero-daily.timer']])

    def test_api_state_is_not_subject_to_root_only_file_guard(self):
        path = m.imported(self.stage, '/var/lib/globaldroptrade-api/community.json')
        original = m.private
        def root_guard(candidate, directory=False):
            self.assertNotEqual(candidate, path)
            return original(candidate, directory)
        with patch.object(m, 'private', root_guard): m.load_snapshot(self.base, 'x86_64')

    def test_api_start_failure_has_write_ahead_resume_phase(self):
        manifest = self.manifest
        state = {'version':1,'manifestSha256':m.digest(self.base/'transfer-manifest.json'),
                 'sourceId':manifest['sourceId'],'phase':'verified','restoredPaths':manifest['paths']}
        write(self.base/'restore-state.json', state)
        def invoke(args, **kw):
            if args == ['systemctl','start','globaldroptrade-api.service']: raise RuntimeError('HOST_RESTORE_FAKE_FAILURE')
        with patch.object(m,'BASE',self.base), patch.object(m,'load_snapshot',lambda *a,**kw:(manifest,self.stage)), \
             patch.object(m,'inactive_target'),patch.object(m,'preflight_destinations'), \
             patch.object(m,'rpc_probe',lambda *a:{'chainId':97,'vaultAddress':'0x'+'12'*20}), \
             patch.object(m,'nginx_verify'),patch.object(m,'call',invoke):
            with self.assertRaisesRegex(RuntimeError, 'FAKE_FAILURE'):m.main(['--execute'])
        self.assertEqual(json.loads((self.base/'restore-state.json').read_text())['phase'],'api-started')

    def test_completed_session_never_restarts_units(self):
        write(self.base/'restore-state.json', {'version':1,'manifestSha256':m.digest(self.base/'transfer-manifest.json'),
              'sourceId':self.manifest['sourceId'],'phase':'complete','restoredPaths':self.manifest['paths']})
        with patch.object(m,'BASE',self.base),patch.object(m.platform,'machine',lambda:'x86_64'), \
             patch.object(m,'call',side_effect=AssertionError('called host command')):
            m.main(['--execute'])


if __name__ == '__main__': unittest.main()

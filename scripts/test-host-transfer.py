#!/usr/bin/env python3
"""Offline host-transfer checks: protected paths, pending guards and finalization."""
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import shlex
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('host_transfer', Path(__file__).with_name('host-transfer.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))
    path.chmod(0o600)


class TransferTests(unittest.TestCase):
    def fixture(self, root):
        for name in ('etc/globaldroptrade','var/lib/globaldroptrade',
                     'var/lib/globaldroptrade-api','var/www/globaldroptrade',
                     'opt/globaldroptrade-api','opt/globaldroptrade-host-bootstrap',
                     'root/global-fresh-reset.7xT5Hi','root/dravon-main',
                     'root/dravon-backup-20261008','root/global-testnet-v071/.testnet-server'):
            (root/name).mkdir(parents=True, exist_ok=True)
        write(root/'etc/globaldroptrade/trades.env', {'placeholder':'private'})
        write(root/'var/lib/globaldroptrade/state/journal.json', {'transactions':{}})
        write(root/'var/lib/globaldroptrade-api/community.json', {'tickets':['preserved']})
        return m.selected_paths(root)

    def test_selection_preserves_both_projects_and_bootstrap(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t); paths=self.fixture(root)
            names=set(map(str,paths))
            self.assertIn(str(root/'root/global-fresh-reset.7xT5Hi'), names)
            self.assertIn(str(root/'root/global-testnet-v071/.testnet-server'), names)
            self.assertIn(str(root/'var/lib/globaldroptrade-api'), names)
            self.assertFalse(any('dravon' in p or p.endswith('host-bootstrap') for p in names))
            self.assertNotIn(str(root/'root'), names)
            self.assertNotIn(str(root/'opt'), names)

    def test_external_symlink_is_rejected_without_following_it(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t); paths=self.fixture(root)
            (root/'opt/globaldroptrade-api/leak').symlink_to(root/'root/dravon-main')
            with self.assertRaisesRegex(RuntimeError,'EXTERNAL_SYMLINK'):
                m.inspect_paths(paths)
            self.assertTrue((root/'root/dravon-main').is_dir())

    def test_internal_symlink_and_regular_files_are_preserved(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t); paths=self.fixture(root)
            target=root/'opt/globaldroptrade-api/releases/one';target.mkdir(parents=True)
            (root/'opt/globaldroptrade-api/current').symlink_to('releases/one')
            self.assertGreater(m.inspect_paths(paths),0)

    def test_source_top_directory_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);self.fixture(root)
            p=root/'etc/globaldroptrade';p.rename(root/'etc/global-preserved')
            p.symlink_to('global-preserved',target_is_directory=True)
            with self.assertRaisesRegex(RuntimeError,'REAL_GLOBAL_DIRECTORY'):
                m.selected_paths(root)

    def test_global_certificate_copies_only_its_scoped_acme_account(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);self.fixture(root)
            account='a'*32
            conf=root/'etc/nginx/sites-available/globaldroptrade.com'
            conf.parent.mkdir(parents=True)
            conf.write_text('ssl_certificate /etc/letsencrypt/live/globaldroptrade.com/fullchain.pem;\n')
            for part in ('live','archive','renewal'):
                p=root/('etc/letsencrypt/'+part)
                p.mkdir(parents=True)
                if part!='renewal':(p/'globaldroptrade.com').mkdir()
            renewal=root/'etc/letsencrypt/renewal/globaldroptrade.com.conf'
            renewal.write_text('version = 4.0.0\n[renewalparams]\naccount = '+account+'\nserver = https://acme-v02.api.letsencrypt.org/directory\n')
            expected=root/('etc/letsencrypt/accounts/acme-v02.api.letsencrypt.org/directory/'+account)
            expected.mkdir(parents=True)
            (expected.parent/('b'*32)).mkdir()
            paths=m.selected_paths(root)
            self.assertIn(expected,paths)
            self.assertNotIn(expected.parent/('b'*32),paths)

    def test_acme_account_traversal_and_alternate_ca_are_rejected(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'renewal.conf'
            for account,server in (('../../root','https://acme-v02.api.letsencrypt.org/directory'),
                ('a'*32,'https://other-ca.example/directory')):
                p.write_text('[renewalparams]\naccount = '+account+'\nserver = '+server+'\n')
                with self.assertRaisesRegex(RuntimeError,'ACME_'):
                    m.renewal_account(p)

    def test_critical_hashes_cover_private_non_json_and_skip_locks(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t); paths=self.fixture(root)
            key=root/'etc/globaldroptrade/operator.key';write(key,'secret-not-printed')
            lock=root/'var/lib/globaldroptrade/state/run.lock';write(lock,{})
            hashes=m.critical_hashes(paths,[root/'etc/globaldroptrade',root/'var/lib/globaldroptrade',root/'var/lib/globaldroptrade-api'])
            self.assertEqual(hashes[str(key)],m.file_hash(key))
            self.assertIn(str(root/'var/lib/globaldroptrade-api/community.json'),hashes)
            self.assertNotIn(str(lock),hashes)

    def test_pending_journal_and_legacy_deploy_guards(self):
        with tempfile.TemporaryDirectory() as t:
            path=Path(t)/'journal.json'
            for value in ({'pending':{'raw':'pending'},'transactions':{}},
                          {'oracle':{'pending':True},'transactions':{}},
                          {'transactions':{'a':{'raw':'signed'}}},
                          {'transactions':{'a':{'block':True}}},
                          {'steps':[{'raw':'signed'}]}, {'unknown':'format'}):
                write(path,value)
                with self.assertRaises(RuntimeError):m.settled_journal(path)
            for value in ({'transactions':{}},{'transactions':{'a':{'block':5,'raw':'preserved'}}},
                          {'steps':[{'blockNumber':12,'raw':'preserved'}]}):
                write(path,value);m.settled_journal(path)

    def test_financial_locks_preserve_reset_inode_and_reject_competing_reset(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);base=root/'state';fallback=root/'fallback';fallback.mkdir()
            lock=base/'fresh-fast-reset-20261031/run.lock';write(lock,{})
            write(base/'fresh-fast-testnet-v1/journal.json',{'transactions':{}})
            inode=lock.stat().st_ino
            with m.financial_locks(base,fallback):
                with self.assertRaises(BlockingIOError):
                    with m.financial_locks(base,fallback):pass
            self.assertEqual(inode,lock.stat().st_ino)

    def test_freeze_never_stops_a_financial_service_and_orders_failover_first(self):
        names=['globaldroptrade-api.service','globaldroptrade-rpc-failover.timer',
               'globaldroptrade-rpc-failover.service','globaldroptrade-zero-daily.timer',
               'globaldroptrade-zero-daily.service','globaldroptrade-old-deploy.service']
        calls=[]
        m.freeze([{'name':n,'unitFileState':'enabled'} for n in names],
            run=lambda args,**kw:calls.append(tuple(args)),
            wait=lambda name:calls.append(('wait',name)))
        self.assertEqual(calls[0],('systemctl','disable','--now','globaldroptrade-rpc-failover.timer'))
        self.assertEqual(calls[1],('wait','globaldroptrade-rpc-failover.service'))
        self.assertTrue(any(c==('systemctl','disable','globaldroptrade-old-deploy.service') for c in calls))
        self.assertFalse(any(c[0]=='systemctl' and '--now' in c and c[-1].endswith('.service') for c in calls))
        self.assertFalse(any('globaldroptrade-api.service' in c for c in calls))

    def test_transient_and_static_services_are_not_disabled(self):
        units=[{'name':'globaldroptrade-old-deploy.service','unitFileState':'transient'},
               {'name':'globaldroptrade-oracles.service','unitFileState':'static'},
               {'name':'globaldroptrade-zero-daily.timer','unitFileState':'enabled'},
               {'name':'globaldroptrade-temporary.timer','unitFileState':'transient'}]
        calls=[];waited=[]
        m.freeze(units,run=lambda args,**kw:calls.append(tuple(args)),wait=waited.append)
        self.assertIn('globaldroptrade-oracles.service',waited)
        self.assertIn(('systemctl','disable','--now','globaldroptrade-zero-daily.timer'),calls)
        self.assertIn(('systemctl','stop','globaldroptrade-temporary.timer'),calls)
        self.assertFalse(any('disable' in args and args[-1].endswith('.service') for args in calls))

    def test_unmanaged_cron_blocks_before_mutation(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);(root/'etc').mkdir();(root/'proc').mkdir()
            (root/'etc/crontab').write_text('* * * * * root node /opt/globaldroptrade-worker/worker.mjs\n')
            with self.assertRaisesRegex(RuntimeError,'CRON_REVIEW'):
                m.refuse_unmanaged_jobs(root/'proc',root)

    def test_long_lived_dravon_process_is_not_modified_or_blocked(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);proc=root/'proc';p=proc/'99999999';p.mkdir(parents=True)
            (p/'comm').write_text('npm start\n');(p/'cwd').symlink_to('/root/dravon-main')
            (p/'cmdline').write_bytes(b'npm start\0');(p/'cgroup').write_text('0::/system.slice/pm2-root.service\n')
            m.refuse_unmanaged_jobs(proc,root)
            self.assertEqual((p/'comm').read_text(),'npm start\n')

    def test_manual_global_signer_is_rejected_without_exposing_arguments(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);proc=root/'proc';p=proc/'99999999';p.mkdir(parents=True)
            (p/'comm').write_text('node\n');(p/'cwd').symlink_to('/root/global-testnet-v071')
            (p/'cmdline').write_bytes(b'node scripts/deploy.mjs --secret=not-printed\0')
            (p/'cgroup').write_text('0::/user.slice/session.scope\n')
            with self.assertRaisesRegex(RuntimeError,'UNMANAGED_GLOBAL_PROCESS') as error:
                m.refuse_unmanaged_jobs(proc,root)
            self.assertNotIn('not-printed',str(error.exception))

    def run_main(self, root, *, fail_final=False):
        paths=self.fixture(root/'source')
        local=root/'local';local.mkdir(mode=0o700)
        events=[];saved=[];frozen=[False]
        unit_names=['globaldroptrade-api.service','globaldroptrade-zero-daily.service','globaldroptrade-zero-daily.timer']
        def units():
            return [{'name':name,'activeState':'inactive' if frozen[0] else 'active',
                     'unitFileState':'disabled' if frozen[0] else 'enabled'} for name in unit_names]
        class FakeConnection:
            def __init__(self,*args):pass
            def remote(self,data):
                if data['action']=='check':return {'ready':True,'priorPhase':saved[-1]['phase'] if saved else None}
                saved.append(copy.deepcopy(data['manifest']));events.append(('manifest',data['manifest']['phase']))
                return {'saved':True}
            def copy(self,paths,log,**kwargs):
                events.append(('copy',kwargs))
                if fail_final and not kwargs.get('initial'):raise RuntimeError('HOST_TRANSFER_FAKE_COPY_FAILED')
            def stage_check(self):events.append(('stage-check',))
            def close(self):pass
        def freeze(units):events.append(('freeze',));frozen[0]=True
        def run(args,**kwargs):events.append(tuple(args));return SimpleNamespace(stdout='a'*40,returncode=0)
        identity={'sourceId':'source','machineIdHash':'machine','sourceHostname':'old-host','sourceArchitecture':'x86_64'}
        with contextlib.ExitStack() as stack:
            for name,value in {'LOCAL_BASE':local,'Connection':FakeConnection,
                'source_identity':lambda:identity,'selected_paths':lambda:paths,
                'inspect_paths':lambda paths:100,'global_units':units,
                'refuse_busy_jobs':lambda units:None,'refuse_unmanaged_jobs':lambda:None,
                'current_config':lambda:{'chainId':97,'vaultAddress':'0x'+'11'*20},
                'freeze':freeze,'financial_locks':lambda:contextlib.nullcontext(),
                'critical_hashes':lambda paths:{str(paths[0]):'f'*64}}.items():
                stack.enter_context(patch.object(m,name,value))
            stack.enter_context(patch.object(m.shutil,'which',lambda name:'/bin/'+name))
            stack.enter_context(patch.object(m.pwd,'getpwnam',lambda name:SimpleNamespace(pw_uid=998,pw_gid=998)))
            stack.enter_context(patch.object(m.subprocess,'run',run))
            with contextlib.redirect_stdout(io.StringIO()):
                if fail_final:
                    with self.assertRaisesRegex(RuntimeError,'FAKE_COPY'):
                        m.main(['--execute'])
                else:
                    m.main(['--execute'])
                    copy_count=sum(e[0]=='copy' for e in events)
                    m.main(['--execute'])
                    self.assertEqual(copy_count,sum(e[0]=='copy' for e in events))
        return events,saved,json.loads((local/'session.json').read_text())

    def test_final_marker_requires_stage_rpc_freeze_and_verified_final_copy(self):
        with tempfile.TemporaryDirectory() as t:
            events,saved,state=self.run_main(Path(t))
            self.assertLess(events.index(('stage-check',)),events.index(('freeze',)))
            final=saved[-1]
            self.assertEqual(final['phase'],'copied')
            self.assertTrue(final['consistent'] and final['sourceFrozen'])
            self.assertTrue(final['criticalHashes'])
            self.assertEqual(state['phase'],'copied')
            self.assertTrue(any(e[0]=='copy' and e[1].get('dry_run') for e in events))
            self.assertFalse(any(e[0]=='systemctl' and e[-1]!='globaldroptrade-api.service' for e in events))

    def test_copy_failure_never_publishes_consistent_state_or_restarts_source(self):
        with tempfile.TemporaryDirectory() as t:
            events,saved,state=self.run_main(Path(t),fail_final=True)
            self.assertFalse(any(v['consistent'] for v in saved))
            self.assertEqual(state['phase'],'frozen')
            self.assertFalse(any(e[0]=='systemctl' and 'start' in e for e in events))

    def test_stage_check_uses_new_install_root_and_keeps_ssh_port_22(self):
        connection=m.Connection(m.DESTINATION,22,Path('/run/test-host-transfer'))
        calls=[]
        with patch.object(m.subprocess,'run',lambda args,**kw:calls.append(args)):
            connection.stage_check()
        command=calls[0]
        self.assertEqual(command[command.index('-p')+1],'22')
        self.assertEqual(shlex.split(command[-1]),
            ['python3','/opt/globaldroptrade/scripts/host-restore.py','--stage-check'])
        self.assertNotIn('8898',command)

    def test_target_marker_requires_install_root_and_frontend_port(self):
        with tempfile.TemporaryDirectory() as t:
            base=Path(t);base.chmod(0o700)
            template={'version':1,'destinationIp':m.DESTINATION,'phase':'prepared',
                      'installRoot':'/opt/globaldroptrade','sitePort':8898}
            script=m.REMOTE.replace("base=pathlib.Path('/var/lib/globaldroptrade-host-migration')",
                                   'base=pathlib.Path('+repr(str(base))+')',1)
            variants=[{k:v for k,v in template.items() if k!='installRoot'},
                      {**template,'installRoot':'/opt/globaldroptrade-host-bootstrap'},
                      {k:v for k,v in template.items() if k!='sitePort'},
                      {**template,'sitePort':22},{**template,'sitePort':'8898'}]
            for marker in variants:
                write(base/'prepared.json',marker)
                with patch('sys.stdin',io.StringIO(json.dumps({'destinationIp':m.DESTINATION}))), \
                     patch('platform.machine',side_effect=AssertionError('Marker validation was bypassed')):
                    with self.assertRaisesRegex(SystemExit,'TARGET_NOT_PREPARED'):
                        exec(script,{})
            write(base/'prepared.json',template)
            with patch('sys.stdin',io.StringIO(json.dumps({'destinationIp':m.DESTINATION}))), \
                 patch('platform.machine',side_effect=StopIteration('marker accepted')):
                with self.assertRaisesRegex(StopIteration,'marker accepted'):
                    exec(script,{})


if __name__=='__main__':unittest.main()

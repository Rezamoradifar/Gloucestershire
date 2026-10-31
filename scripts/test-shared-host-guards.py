#!/usr/bin/env python3
"""Ensure legacy installers refuse the known shared host before mutations."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parent.parent
SHARED = 'vps-titan-5320.example'


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-','_'), ROOT/'scripts'/(name+'.py'))
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


restore = module('host-restore')
site = module('host-site-port')
reset = module('reset-fast-testnet-20261031')
transfer = module('host-transfer')


class SharedHostTests(unittest.TestCase):
    def test_shell_modes_refuse_before_tools_or_state_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); binary = root/'bin'; binary.mkdir()
            trace = root/'mutations'
            (binary/'id').write_text('#!/bin/sh\nprintf "0\\n"\n')
            (binary/'hostname').write_text('#!/bin/sh\nprintf "vps-titan-5320\\n"\n')
            for name in ('python3','systemctl','flock','apt-get','useradd','ufw','install','mkdir','npm','nginx'):
                (binary/name).write_text('#!/bin/sh\nprintf "%s\\n" "'+name+'" >> "$TASK_MUTATION_TRACE"\nexit 97\n')
            for path in binary.iterdir(): path.chmod(0o755)
            env = {**os.environ,'PATH':str(binary)+':'+os.environ['PATH'],'TASK_MUTATION_TRACE':str(trace)}
            for mode in ('--prepare','--restore','--finish-testnet'):
                with self.subTest(mode=mode):
                    result = subprocess.run(['/bin/bash',str(ROOT/'ubuntu-new-host.sh'),mode,
                                             '--target-ip','185.114.206.44'],env=env,
                                            text=True,capture_output=True)
                    self.assertNotEqual(result.returncode,0)
                    self.assertIn('HOST_INSTALL_ISOLATED_SHARED_HOST_RUNTIME_REQUIRED',result.stdout)
                    self.assertFalse(trace.exists())

    def test_restore_modes_refuse_before_private_state_or_host_commands(self):
        for mode in ('--stage-check','--check','--execute'):
            with self.subTest(mode=mode), patch.object(restore.socket,'gethostname',lambda:SHARED), \
                 patch.object(restore.os,'geteuid',lambda:0), \
                 patch.object(restore,'private',side_effect=AssertionError('inspected state')), \
                 patch.object(restore.os,'open',side_effect=AssertionError('opened state')), \
                 patch.object(restore,'call',side_effect=AssertionError('ran host command')):
                with self.assertRaisesRegex(RuntimeError,'HOST_RESTORE_ISOLATED_SHARED_HOST_RUNTIME_REQUIRED'):
                    restore.main([mode])

    def test_port_modes_refuse_before_site_or_backup_access(self):
        for mode in ('--check','--execute'):
            with self.subTest(mode=mode),patch.object(site.socket,'gethostname',lambda:SHARED), \
                 patch.object(site.os,'geteuid',lambda:0), \
                 patch.object(site,'SitePort',side_effect=AssertionError('opened site state')):
                with self.assertRaisesRegex(RuntimeError,'HOST_SITE_PORT_ISOLATED_SHARED_HOST_RUNTIME_REQUIRED'):
                    site.main([mode])

    def test_reset_refuses_before_session_or_worker_changes(self):
        with patch.object(reset.socket,'gethostname',lambda:SHARED), \
             patch.object(reset.os,'getuid',lambda:0), \
             patch.object(reset.sys,'argv',['reset','--execute']), \
             patch.object(Path,'mkdir',side_effect=AssertionError('created session')), \
             patch.object(reset,'run',side_effect=AssertionError('ran worker command')), \
             patch.object(reset,'quiesce',side_effect=AssertionError('changed worker')):
            with self.assertRaisesRegex(RuntimeError,'RESET_ISOLATED_SHARED_HOST_RUNTIME_REQUIRED'):reset.main()

    def execute_remote_guard(self, data):
        with patch.object(transfer.socket,'gethostname',lambda:SHARED), \
             patch.object(transfer.os,'geteuid',lambda:0), \
             patch.object(transfer.sys,'stdin',io.StringIO(json.dumps(data))), \
             patch.object(Path,'mkdir',side_effect=AssertionError('created target path')), \
             patch.object(transfer.os,'open',side_effect=AssertionError('opened target state')), \
             patch.object(transfer.subprocess,'run',side_effect=AssertionError('ran target command')):
            exec(compile(transfer.REMOTE,'<target-preflight>','exec'),{})

    def test_remote_target_refuses_before_import_or_service_changes(self):
        with self.assertRaisesRegex(SystemExit,'HOST_TRANSFER_TARGET_ISOLATED_SHARED_HOST_RUNTIME_REQUIRED'):
            self.execute_remote_guard({'action':'check'})

    def test_rejected_target_cannot_reach_source_freeze(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); freeze = Mock(side_effect=AssertionError('froze source'))
            remote_guard = self.execute_remote_guard
            class Connection:
                def __init__(self,*args): pass
                def remote(self,data): return remote_guard(data)
                def close(self): pass
            original_temporary = tempfile.TemporaryDirectory
            with contextlib.ExitStack() as stack:
                values = {'LOCAL_BASE':root/'source-control','Connection':Connection,
                          'source_identity':lambda:{'sourceId':'a'*64,'machineIdHash':'b'*64,
                                                   'sourceHostname':'old-host','sourceArchitecture':'x86_64'},
                          'selected_paths':lambda:[], 'inspect_paths':lambda paths:0,
                          'global_units':lambda:[], 'refuse_busy_jobs':lambda units:None,
                          'refuse_unmanaged_jobs':lambda:None,
                          'current_config':lambda:{'chainId':97,'vaultAddress':'0x'+'11'*20},
                          'freeze':freeze}
                for name,value in values.items(): stack.enter_context(patch.object(transfer,name,value))
                stack.enter_context(patch.object(transfer.shutil,'which',lambda name:'/bin/'+name))
                stack.enter_context(patch.object(transfer.pwd,'getpwnam',lambda name:SimpleNamespace(pw_uid=123,pw_gid=123)))
                stack.enter_context(patch.object(transfer.subprocess,'run',lambda *a,**kw:SimpleNamespace(stdout='a'*40,returncode=0)))
                stack.enter_context(patch.object(transfer.tempfile,'TemporaryDirectory',
                    lambda **kw:original_temporary(prefix='transfer-test-',dir=root)))
                with self.assertRaisesRegex(SystemExit,'HOST_TRANSFER_TARGET_ISOLATED_SHARED_HOST_RUNTIME_REQUIRED'):
                    transfer.main(['--execute'])
            freeze.assert_not_called()
            self.assertFalse((root/'source-control/session.json').exists())


if __name__ == '__main__':unittest.main()

#!/usr/bin/env python3
"""Offline tests: interrupted archive, locks, pending signatures and reset resume."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
spec=importlib.util.spec_from_file_location('reset',Path(__file__).with_name('reset-fast-testnet.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def write(p,v):
 p.parent.mkdir(parents=True,exist_ok=True,mode=0o700);p.write_text(json.dumps(v));p.chmod(0o600)
def fixture(root):
 base=root/'state';session=base/'reset';session.mkdir(parents=True,mode=0o700)
 for name in m.NAMES:
  write(base/name/'journal.json',{'transactions':{'old':{'block':1,'raw':'old-signed-bytes'}}})
  write(base/name/'run.lock',{})
 write(base/m.NAMES[0]/'deployment-public.json',{'chainId':97,'contractAddress':m.OLD})
 write(base/m.NAMES[1]/'daily-policy.json',{'chainId':97,'vaultAddress':m.OLD})
 return base,session
with tempfile.TemporaryDirectory() as t:
 root=Path(t)
 base,session=fixture(root)
 inode=(base/m.NAMES[0]/'run.lock').stat().st_ino
 state=m.plan_archive(base,session)
 row=state['files'][0];src=base/row['path'];dest=session/'previous-state'/row['path'];dest.parent.mkdir(mode=0o700,parents=True,exist_ok=True);os.rename(src,dest)
 m.archive(base,session,state)
 assert state['phase']=='archived'
 assert (base/m.NAMES[0]/'run.lock').stat().st_ino==inode
 assert 'old-signed-bytes' in (session/'previous-state'/m.NAMES[0]/'journal.json').read_text()
 m.archive(base,session,state)
 for j in ({'transactions':{'x':{'raw':'pending'}}},{'pending':{'x':1}},{'oracle':{'pending':{'x':1}}}):
  p=root/'pending.json';write(p,j)
  try:m.settled(p);raise AssertionError('pending accepted')
  except RuntimeError:pass
 p=root/'lock'
 with m.locks([p]):
  try:
   with m.locks([p]):raise AssertionError('busy lock accepted')
  except BlockingIOError:pass
with tempfile.TemporaryDirectory() as t:
 root=Path(t);base,session=fixture(root)
 p=base/m.NAMES[1]/'daily-policy.json';write(p,{'chainId':56,'vaultAddress':m.OLD})
 try:m.plan_archive(base,session);raise AssertionError('mainnet accepted')
 except RuntimeError:pass
 assert (base/m.NAMES[0]/'journal.json').exists() and not (session/'session.json').exists()
with tempfile.TemporaryDirectory() as t:
 root=Path(t);base,session=fixture(root);state=m.plan_archive(base,session)
 write(base/state['files'][0]['path'],{'unexpected':'changed'})
 try:m.archive(base,session,state);raise AssertionError('changed source accepted')
 except RuntimeError:pass
 assert (base/state['files'][0]['path']).exists()
# Real installed states contain nested installer rollback directories. They must
# remain at their original paths, without weakening symlink or unknown-directory guards.
with tempfile.TemporaryDirectory() as t:
 root=Path(t);base,session=fixture(root)
 backup=base/m.NAMES[1]/'install-20261026T234653-534394'
 write(backup/'journal.json',{'transactions':{'historical':{'raw':'preserved-backup-bytes'}}})
 content=(backup/'journal.json').read_bytes();inode=backup.stat().st_ino
 state=m.plan_archive(base,session)
 assert state['preservedInstallerBackups']==[m.NAMES[1]+'/'+backup.name]
 assert all('install-' not in f['path'] for f in state['files'])
 m.archive(base,session,state)
 assert backup.stat().st_ino==inode and (backup/'journal.json').read_bytes()==content
 assert not (base/m.NAMES[1]/'journal.json').exists()
 assert (session/'previous-state'/m.NAMES[1]/'journal.json').exists()
for kind in ('unknown-directory','symlink-directory','public-backup'):
 with tempfile.TemporaryDirectory() as t:
  root=Path(t);base,session=fixture(root)
  p=base/m.NAMES[1]/'install-20261026T234653-534394'
  if kind=='unknown-directory':p=p.with_name('unreviewed-folder');p.mkdir(mode=0o700)
  elif kind=='public-backup':p.mkdir(mode=0o755)
  else:p.symlink_to(session, target_is_directory=True)
  try:m.plan_archive(base,session);raise AssertionError('unsafe backup accepted: '+kind)
  except RuntimeError:pass
  assert not (session/'session.json').exists()
  assert (base/m.NAMES[1]/'journal.json').exists()
# Resume after a child deployment failure cannot archive the new journal or redeploy twice.
with tempfile.TemporaryDirectory() as t:
 root=Path(t);base,session=fixture(root);state=m.plan_archive(base,session);m.archive(base,session,state)
 m.BASE=base;m.SESSION=session;m.quiesce=lambda:None
 new='0x'+'12'*20;calls=[];fail=[True]
 def run(*args):
  calls.append(args)
  if args[1]=='ubuntu-deploy-zero-start.sh':
   p=base/m.NAMES[0]/'journal.json'
   if not p.exists():write(p,{'transactions':{'new':{'raw':'new-pending'}}})
   assert 'new-pending' in p.read_text()
   if fail[0]:fail[0]=False;raise RuntimeError('RESET_FAKE_PENDING')
   write(base/m.NAMES[0]/'deployment-public.json',{'chainId':97,'contractAddress':new,'emptyAtDeployment':True})
  elif args[1]=='ubuntu-zero-oracle.sh':
   write(base/m.NAMES[1]/'daily-policy.json',{'chainId':97,'vaultAddress':new,'periodSeconds':3600})
 m.run=run;m.sys.argv=['reset','--execute']
 try:m.main();raise AssertionError('expected failure')
 except RuntimeError:pass
 assert json.loads((session/'session.json').read_text())['phase']=='archived'
 m.main();count=len(calls);m.main();assert len(calls)==count
 assert json.loads((session/'session.json').read_text())['phase']=='complete'
 assert (session/'previous-state'/m.NAMES[0]/'journal.json').exists()
print('RESET_OFFLINE_TESTS_PASSED: installed backup preservation, unsafe directory rejection, archive resume, original lock inodes, pending guards, mainnet rejection, changed inputs, preserved new signatures and completed-session idempotency')

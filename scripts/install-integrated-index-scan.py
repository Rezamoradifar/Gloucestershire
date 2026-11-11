#!/usr/bin/env python3
"""Guarded testnet scan release: no signer, transfers, journal or policy changes."""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import shutil
import stat
import subprocess
import tempfile
import time
import urllib.request

REPO = Path(__file__).resolve().parent.parent
RELEASES = Path('/opt/globaldroptrade-new-deployer-daily/releases')
STATE = Path('/var/lib/globaldroptrade/new-deployer-testnet-automation-v1')
BACKUPS = Path('/var/backups/globaldroptrade')
SERVICE = 'globaldroptrade-new-deployer-daily.service'
UNIT = Path('/etc/systemd/system') / SERVICE
TIMER = 'globaldroptrade-new-deployer-daily.timer'
TARGET = '0x4c0f6141b18971db4b14e45c0be8cddb09febc14'
IDENTITY_FILES = [Path('/etc/globaldroptrade/trades.env'), STATE/'journal.json', STATE/'daily-policy.json', Path('/var/lib/globaldroptrade/new-deployer-testnet-v1/deployment-public.json'), Path('/var/lib/globaldroptrade/new-deployer-testnet-v1/connection-public.json')]
BASE_LOG_HASH = 'a19600c298911adbebf76702fbe75dc5c24f88e9f0801d112a8f5c7163dc6c1d'
NEW_LOG_HASH = '4fa822c374a93276fd536dd17b8172f1765da3e0227e1d9978386b850f998a01'
VERSIONS = {
 'f830943e4cea5f16939ef92dd6ef959bfb175cea0e3b5f8da4aec1368e6371f7': ('scripts/position-profit-legacy-optimized.mjs', 'd505f824f705a3f52fd9585510b565dccf84cf5b254c3ee5cde76ae91d7edf3e', 'c7ad8d4de6a62bb47177035c4869c601593636c062c381c27bbb2d3a85bf6dd9'),
 '93798c19d85b072954425f6a9acde4c168cb8bac60dba9cdd9215cea9e768dc1': ('scripts/position-profit.mjs', '13794351f50f651f470006bf9a1f49aa60bdbe50900082eac6f23f8c8092ede2', '31fa2c0c49b89863857f35ea92dd399e4461d0ac2d962efeb9ab122410009d1b'),
}
DAILY_HASH = '3f60e617fedec65868127e6b266664a89da7fa44f08c1db6482832da82b9ced6'
WORKERS = {'c7ad8d4de6a62bb47177035c4869c601593636c062c381c27bbb2d3a85bf6dd9', '31fa2c0c49b89863857f35ea92dd399e4461d0ac2d962efeb9ab122410009d1b'}

def digest(data): return hashlib.sha256(data).hexdigest()

def root_directory(path, private=False):
 s=path.lstat()
 if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_mode&0o022 or (private and s.st_mode&0o077):
  raise RuntimeError('INDEX_SCAN_UNSAFE_DIRECTORY')

def read_file(path):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  s=os.fstat(fd)
  if not stat.S_ISREG(s.st_mode) or s.st_uid!=0 or s.st_mode&0o022 or s.st_nlink!=1 or s.st_size>4000000:
   raise RuntimeError('INDEX_SCAN_UNSAFE_FILE')
  with os.fdopen(fd,'rb',closefd=False) as stream: return stream.read(),s
 finally: os.close(fd)

def run(*args):
 return subprocess.run(args,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=15).stdout.strip()

def status():
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
 def read(route):
  with opener.open('http://127.0.0.1:3115'+route,timeout=8) as response: return json.load(response)
 config,automation=read('/api/config'),read('/api/automation/status')
 for row in (config,automation):
  if row.get('chainId')!=97 or str(row.get('vaultAddress','')).lower()!=TARGET: raise RuntimeError('INDEX_SCAN_TARGET_MISMATCH')
 if automation.get('fresh') is not True or automation.get('dailyStatus') not in ('ready','not_due') or automation.get('blockers')!=[]:
  raise RuntimeError('INDEX_SCAN_WAIT_FOR_READY')

def worker_location():
 root_directory(RELEASES)
 directory=Path(run('systemctl','show',SERVICE,'-p','WorkingDirectory','--value'))
 if not directory.is_absolute() or directory.resolve()!=directory or directory.parent!=RELEASES:
  raise RuntimeError('INDEX_SCAN_WORKER_RELEASE_MISMATCH')
 root_directory(directory);root_directory(directory/'scripts')
 expected=str(directory/'scripts/new-deployer-testnet-automation.mjs')
 unit=run('systemctl','show',SERVICE,'-p','ExecStart','--value')
 if expected not in unit or '--execute' not in unit: raise RuntimeError('INDEX_SCAN_WORKER_UNIT_MISMATCH')
 if digest(read_file(Path(expected))[0]) not in WORKERS: raise RuntimeError('INDEX_SCAN_WORKER_VERSION_MISMATCH')
 if digest(read_file(directory/'scripts/daily-profit.mjs')[0])!=DAILY_HASH: raise RuntimeError('INDEX_SCAN_DEPENDENCY_VERSION_MISMATCH')
 if digest(read_file(directory/'scripts/complete-rpc-logs.mjs')[0])!=BASE_LOG_HASH: raise RuntimeError('INDEX_SCAN_DEPENDENCY_VERSION_MISMATCH')
 return directory

def is_active(unit): return subprocess.run(['systemctl','is-active','--quiet',unit],timeout=10).returncode==0

def worker_idle():
 if not is_active(TIMER): raise RuntimeError('INDEX_SCAN_TIMER_INACTIVE')
 if run('systemctl','show',SERVICE,'-p','ActiveState','--value')!='inactive': raise RuntimeError('INDEX_SCAN_WORKER_BUSY')

def timer_window():
 unit='/org/freedesktop/systemd1/unit/globaldroptrade_2dnew_2ddeployer_2ddaily_2etimer'
 value=run('busctl','--system','get-property','org.freedesktop.systemd1',unit,'org.freedesktop.systemd1.Timer','NextElapseUSecMonotonic')
 match=re.fullmatch(r't ([0-9]+)',value)
 if not match or int(match.group(1))-(time.monotonic_ns()//1000)<90_000_000:
  raise RuntimeError('INDEX_SCAN_TIMER_WINDOW_REQUIRED')

def identity_inputs():
 # Exact bytes are retained only in private memory, never printed.
 return tuple(read_file(file)[0] for file in IDENTITY_FILES)

def probe_index():
 raw=run('node',str(REPO/'scripts/preflight-index-auto.mjs'),'--check')
 prefix='INDEX_AUTO_READ_ONLY_PROBE '
 if not raw.startswith(prefix): raise RuntimeError('INDEX_SCAN_PROBE_REQUIRED')
 report=json.loads(raw[len(prefix):])
 if report.get('chainId')!=97 or report.get('targetMatches') is not True or report.get('runtimeMatches') is not True or report.get('pendingFinancial') is not False or report.get('journalUnchangedDuringProbe') is not True or report.get('policyUnchangedDuringProbe') is not True:
  raise RuntimeError('INDEX_SCAN_PROBE_REQUIRED')
 checks=report.get('blockChecks') or {}
 if any(checks.get(key) is not True for key in ('target','member','position')) or not all(report.get('financialBlockChecks') or []):
  raise RuntimeError('INDEX_SCAN_PROBE_REQUIRED')
 if report.get('signerOpened') is not False or report.get('transactionsSent')!=0 or report.get('journalWritten') is not False:
  raise RuntimeError('INDEX_SCAN_PROBE_REQUIRED')

def render_unit(unit,old,new):
 text=unit.decode('utf-8');before=str(old);after=str(new)
 old_work='WorkingDirectory='+before
 old_exec=before+'/scripts/new-deployer-testnet-automation.mjs'
 lines=text.splitlines(keepends=True)
 work=[i for i,line in enumerate(lines) if line.rstrip('\r\n')==old_work]
 execution=[i for i,line in enumerate(lines) if line.startswith('ExecStart=') and old_exec in line and '--execute' in line]
 if len(work)!=1 or len(execution)!=1 or text.count(before)!=2: raise RuntimeError('INDEX_SCAN_UNIT_CONTENT_MISMATCH')
 return text.replace(before,after).encode('utf-8')

def make_temp(parent,data,mode):
 fd,name=tempfile.mkstemp(prefix='.index-scan-',dir=parent)
 try:
  os.fchmod(fd,mode)
  with os.fdopen(fd,'wb',closefd=False) as out: out.write(data);out.flush();os.fsync(out.fileno())
 finally: os.close(fd)
 return Path(name)

def sync_directory(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
 try: os.fsync(fd)
 finally: os.close(fd)

def sync_tree(root):
 # The old release remains available, but the new one must survive a crash
 # before a systemd reload can point to it. Never follow symlinks.
 for directory,_,files in os.walk(root,topdown=False,followlinks=False):
  for name in files:
   path=Path(directory)/name
   if path.is_symlink(): continue
   fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
   try:
    if not stat.S_ISREG(os.fstat(fd).st_mode): raise RuntimeError('INDEX_SCAN_UNSAFE_FILE')
    os.fsync(fd)
   finally: os.close(fd)
  sync_directory(Path(directory))
 sync_directory(root.parent)

def lock_worker():
 root_directory(STATE,private=True);path=STATE/'run.lock'
 try: fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 except FileExistsError: raise RuntimeError('INDEX_SCAN_WORKER_BUSY')
 s=os.fstat(fd)
 try: os.write(fd,str(os.getpid()).encode());os.fsync(fd)
 except BaseException:
  os.close(fd)
  try:
   q=path.lstat()
   if (q.st_dev,q.st_ino)==(s.st_dev,s.st_ino): path.unlink()
  except FileNotFoundError: pass
  raise
 os.close(fd)
 return path,s.st_dev,s.st_ino

def unlock_worker(lock):
 path,dev,ino=lock;data,s=read_file(path)
 if (s.st_dev,s.st_ino)!=(dev,ino) or data!=str(os.getpid()).encode(): raise RuntimeError('INDEX_SCAN_LOCK_CHANGED')
 path.unlink()

def install(mode):
 if os.geteuid()!=0: raise RuntimeError('INDEX_SCAN_ROOT_REQUIRED')
 status();worker_idle();timer_window();before_inputs=identity_inputs();probe_index()
 if identity_inputs()!=before_inputs: raise RuntimeError('INDEX_SCAN_INPUT_CHANGED')
 old=worker_location()
 old_position,_=read_file(old/'scripts/position-profit.mjs');choice=VERSIONS.get(digest(old_position))
 if not choice: raise RuntimeError('INDEX_SCAN_VERSION_MISMATCH')
 source,wanted,expected_worker=choice
 if digest(read_file(old/'scripts/new-deployer-testnet-automation.mjs')[0])!=expected_worker: raise RuntimeError('INDEX_SCAN_WORKER_VERSION_MISMATCH')
 optimized,_=read_file(REPO/source);logs,_=read_file(REPO/'scripts/complete-rpc-logs.mjs')
 if digest(optimized)!=wanted or digest(logs)!=NEW_LOG_HASH: raise RuntimeError('INDEX_SCAN_PATCH_MISMATCH')
 original,meta=read_file(UNIT);render_unit(original,old,RELEASES/'index-placeholder')
 run('node','--check',str(REPO/source));run('node','--check',str(REPO/'scripts/complete-rpc-logs.mjs'))
 print('INDEX_SCAN_PREFLIGHT_PASSED',flush=True)
 if mode=='--check': return
 root_directory(BACKUPS,private=True);root_directory(UNIT.parent)
 backup=Path(tempfile.mkdtemp(prefix='index-scan-',dir=BACKUPS));os.chmod(backup,0o700)
 backup_file=make_temp(backup,original,0o600);os.replace(backup_file,backup/'worker.service');sync_directory(backup)
 new=Path(tempfile.mkdtemp(prefix='index-scan-',dir=RELEASES))
 shutil.copytree(old,new,symlinks=True,dirs_exist_ok=True);new.chmod(0o755)
 if digest(read_file(new/'scripts/new-deployer-testnet-automation.mjs')[0])!=expected_worker or digest(read_file(new/'scripts/daily-profit.mjs')[0])!=DAILY_HASH:
  raise RuntimeError('INDEX_SCAN_DEPENDENCY_VERSION_MISMATCH')
 for name,data,want in [('position-profit.mjs',optimized,wanted),('complete-rpc-logs.mjs',logs,NEW_LOG_HASH)]:
  target=new/'scripts'/name
  if target.is_symlink(): raise RuntimeError('INDEX_SCAN_UNSAFE_FILE')
  staged=make_temp(target.parent,data,0o644);os.replace(staged,target)
  if digest(read_file(target)[0])!=want: raise RuntimeError('INDEX_SCAN_PATCH_MISMATCH')
 sync_tree(new)
 run('node','--check',str(new/'scripts/position-profit.mjs'));run('node','--check',str(new/'scripts/complete-rpc-logs.mjs'))
 replacement=render_unit(original,old,new);staged_unit=make_temp(UNIT.parent,replacement,meta.st_mode&0o777)
 lock=None;changed=False
 try:
  worker_idle();timer_window()
  signals={signal.SIGTERM,signal.SIGINT,signal.SIGHUP}
  previous_mask=signal.pthread_sigmask(signal.SIG_BLOCK,signals)
  try: lock=lock_worker()
  finally: signal.pthread_sigmask(signal.SIG_SETMASK,previous_mask)
  worker_idle();timer_window()
  if worker_location()!=old or read_file(UNIT)[0]!=original or digest(read_file(old/'scripts/position-profit.mjs')[0])!=digest(old_position) or identity_inputs()!=before_inputs:
   raise RuntimeError('INDEX_SCAN_RELEASE_CHANGED')
  timer_window()
  changed=True;os.replace(staged_unit,UNIT);sync_directory(UNIT.parent)
  run('systemctl','daemon-reload')
  if Path(run('systemctl','show',SERVICE,'-p','WorkingDirectory','--value'))!=new: raise RuntimeError('INDEX_SCAN_UNIT_SWITCH_FAILED')
  if str(new/'scripts/new-deployer-testnet-automation.mjs') not in run('systemctl','show',SERVICE,'-p','ExecStart','--value'): raise RuntimeError('INDEX_SCAN_UNIT_SWITCH_FAILED')
  if not is_active(TIMER): raise RuntimeError('INDEX_SCAN_TIMER_INACTIVE')
 except BaseException:
  if changed:
   try:
    restored=make_temp(UNIT.parent,original,meta.st_mode&0o777);os.replace(restored,UNIT);sync_directory(UNIT.parent)
    run('systemctl','daemon-reload');print('INDEX_SCAN_ROLLBACK_COMPLETED',flush=True)
   except Exception: print('INDEX_SCAN_ROLLBACK_REVIEW_REQUIRED',flush=True)
  raise
 finally:
  if staged_unit.exists(): staged_unit.unlink()
  if lock:
   try: unlock_worker(lock)
   except BaseException:
    if changed: print('INDEX_SCAN_SWITCHED_LOCK_REVIEW_REQUIRED',flush=True)
    raise
 print('INDEX_SCAN_INSTALLED',flush=True)
 print('OLD_UNIT_BACKUP',backup/'worker.service',flush=True)
 print('NO_SIGNER_OR_PAYMENT_TESTED',flush=True)

if __name__=='__main__':
 import sys
 try:
  if len(sys.argv)!=2 or sys.argv[1] not in ('--check','--execute'): raise RuntimeError('INDEX_SCAN_USAGE')
  def stop(_signum,_frame): raise SystemExit(143)
  signal.signal(signal.SIGTERM,stop)
  signal.signal(signal.SIGINT,stop)
  signal.signal(signal.SIGHUP,stop)
  install(sys.argv[1])
 except Exception as error:
  value=str(error)
  print(value if re.fullmatch(r'INDEX_SCAN_[A-Z_]+',value) else 'INDEX_SCAN_STOPPED')
  raise SystemExit(1)

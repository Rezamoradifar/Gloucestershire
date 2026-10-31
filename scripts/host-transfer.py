#!/usr/bin/env python3
"""Copy Global to a private destination import, freezing only Global at final sync."""
import argparse
import configparser
import contextlib
import datetime
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import platform
import pwd
import re
import shlex
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time

DESTINATION = '185.114.206.44'
INSTALL_ROOT = '/opt/globaldroptrade'
SITE_PORT = 8898
REMOTE_BASE = '/var/lib/globaldroptrade-host-migration'
LOCAL_BASE = Path('/var/lib/globaldroptrade-host-transfer')
REPO = Path(__file__).resolve().parent.parent
ALLOWED_WORKERS = {
    'globaldroptrade-zero-daily.service', 'globaldroptrade-automation.service',
    'globaldroptrade-oracles.service', 'globaldroptrade-rpc-failover.service',
}
QUIET = {'inactive', 'failed', ''}


def fail(reason):
    raise RuntimeError(reason)


def private(path, directory=False):
    s = path.lstat()
    if s.st_uid != 0 or s.st_mode & 0o077 or not (
        stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode)
    ):
        fail('HOST_TRANSFER_PRIVATE_PATH_REQUIRED')


def atomic_json(path, value):
    fd, name = tempfile.mkstemp(prefix='.'+path.name+'-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
        fd = os.open(path.parent, os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def file_hash(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b''):
            h.update(chunk)
    return h.hexdigest()


def beneath(path, roots):
    return any(path == root or root in path.parents for root in roots)


def renewal_account(path):
    parser = configparser.ConfigParser(interpolation=None)
    # Certbot stores top-level lineage settings before its renewalparams section.
    parser.read_string('[lineage]\n'+path.read_text())
    if not parser.has_section('renewalparams'):
        fail('HOST_TRANSFER_ACME_RENEWAL_REVIEW_REQUIRED')
    server = parser.get('renewalparams', 'server', fallback='')
    account = parser.get('renewalparams', 'account', fallback='')
    if server and server != 'https://acme-v02.api.letsencrypt.org/directory':
        fail('HOST_TRANSFER_ACME_SERVER_REVIEW_REQUIRED')
    if account:
        if server != 'https://acme-v02.api.letsencrypt.org/directory' or not re.fullmatch(r'[0-9a-f]{32}', account):
            fail('HOST_TRANSFER_ACME_ACCOUNT_REVIEW_REQUIRED')
        return '/etc/letsencrypt/accounts/acme-v02.api.letsencrypt.org/directory/'+account
    return None


def selected_paths(base=Path('/')):
    """Select explicit Global trees, never a whole /root, /opt or Nginx tree."""
    def local(name):
        return base/name.lstrip('/')
    paths = []
    def add(path, required=False):
        if not path.exists() and not path.is_symlink():
            if required:
                fail('HOST_TRANSFER_REQUIRED_GLOBAL_PATH_MISSING')
            return
        if path.parent.resolve() != path.parent:
            fail('HOST_TRANSFER_SYMLINK_PARENT_REVIEW_REQUIRED')
        if path.lstat().st_uid != 0:
            # The API state is owned by the unprivileged API service account.
            if path != local('/var/lib/globaldroptrade-api'):
                fail('HOST_TRANSFER_ROOT_OWNED_PATH_REQUIRED')
        paths.append(path)
    for name in ('/etc/globaldroptrade', '/var/lib/globaldroptrade',
                 '/var/lib/globaldroptrade-api', '/var/www/globaldroptrade'):
        p = local(name)
        add(p, required=True)
        if not stat.S_ISDIR(p.lstat().st_mode):
            fail('HOST_TRANSFER_REAL_GLOBAL_DIRECTORY_REQUIRED')
    add(local('/var/backups/globaldroptrade'))
    add(local('/root/global-testnet-v071/.testnet-server'))
    for p in sorted(local('/opt').glob('globaldroptrade-*')):
        if p.name != 'globaldroptrade-host-bootstrap':
            add(p)
    for p in sorted(local('/root').glob('global-fresh-reset.*')):
        if not re.fullmatch(r'global-fresh-reset\.[A-Za-z0-9]+', p.name):
            fail('HOST_TRANSFER_RESET_PATH_REVIEW_REQUIRED')
        add(p)
    for p in sorted(local('/etc/systemd/system').glob('globaldroptrade-*')):
        if not re.fullmatch(r'globaldroptrade-[A-Za-z0-9_.@-]+\.(service|timer)(\.d)?', p.name):
            fail('HOST_TRANSFER_UNIT_PATH_REVIEW_REQUIRED')
        add(p)
    for name in ('/etc/nginx/sites-available/globaldroptrade.com',
                 '/etc/nginx/sites-enabled/globaldroptrade.com',
                 '/etc/nginx/snippets/globaldroptrade-api.conf'):
        add(local(name))
    # Copy only the certificate lineage referenced by the Global domain config.
    config = local('/etc/nginx/sites-available/globaldroptrade.com')
    lineages = set()
    if config.exists():
        if not stat.S_ISREG(config.lstat().st_mode):
            fail('HOST_TRANSFER_NGINX_CONFIG_REVIEW_REQUIRED')
        text = config.read_text()
        for value in re.findall(r'^\s*ssl_certificate(?:_key)?\s+([^;\s]+)\s*;', text, re.M):
            match = re.fullmatch(r'/etc/letsencrypt/live/(globaldroptrade\.com(?:-\d+)?)/(?:fullchain|privkey|cert|chain)\.pem', value)
            if not match:
                fail('HOST_TRANSFER_CUSTOM_CERTIFICATE_REVIEW_REQUIRED')
            lineages.add(match[1])
        for lineage in sorted(lineages):
            for part in ('live', 'archive'):
                add(local('/etc/letsencrypt/'+part+'/'+lineage), required=True)
            renewal = local('/etc/letsencrypt/renewal/'+lineage+'.conf')
            add(renewal)
            if renewal.exists():
                if not stat.S_ISREG(renewal.lstat().st_mode):
                    fail('HOST_TRANSFER_ACME_RENEWAL_REVIEW_REQUIRED')
                account = renewal_account(renewal)
                if account:
                    add(local(account), required=True)
        if lineages:
            for name in ('/etc/letsencrypt/options-ssl-nginx.conf', '/etc/letsencrypt/ssl-dhparams.pem'):
                add(local(name))
    return sorted(set(paths), key=str)


def tree_entries(paths):
    for path in paths:
        yield path
        if stat.S_ISDIR(path.lstat().st_mode):
            for directory, dirs, files in os.walk(path, followlinks=False):
                for name in sorted(dirs+files):
                    yield Path(directory)/name


def inspect_paths(paths):
    total, seen = 0, set()
    for path in tree_entries(paths):
        s = path.lstat()
        if stat.S_ISLNK(s.st_mode):
            target = Path(os.path.normpath(str(path.parent/os.readlink(path))))
            if not beneath(target, paths):
                fail('HOST_TRANSFER_EXTERNAL_SYMLINK_REVIEW_REQUIRED')
        elif stat.S_ISREG(s.st_mode):
            key = (s.st_dev, s.st_ino)
            if key not in seen:
                total += max(s.st_size, s.st_blocks*512)
                seen.add(key)
        elif stat.S_ISDIR(s.st_mode):
            total += 4096
        else:
            fail('HOST_TRANSFER_SPECIAL_FILE_REVIEW_REQUIRED')
    return total


def critical_hashes(paths, prefixes=None):
    prefixes = prefixes or [Path(p) for p in ('/etc/globaldroptrade', '/var/lib/globaldroptrade',
                '/var/lib/globaldroptrade-api', '/root/global-testnet-v071/.testnet-server',
                '/etc/systemd/system', '/etc/nginx', '/etc/letsencrypt')]
    return {str(p): file_hash(p) for p in tree_entries(paths)
            if not p.name.endswith('.lock') and stat.S_ISREG(p.lstat().st_mode)
            and beneath(p, prefixes)}


def unit_property(unit, prop):
    result = subprocess.run(['systemctl', 'show', '--property='+prop, '--value', unit],
                            text=True, capture_output=True, check=True)
    return result.stdout.strip()


def global_units():
    result = subprocess.run(['systemctl', 'list-unit-files', '--no-legend', '--no-pager',
        'globaldroptrade-*.service', 'globaldroptrade-*.timer'], text=True,
        capture_output=True, check=True)
    active = subprocess.run(['systemctl', 'list-units', '--all', '--plain', '--no-legend', '--no-pager',
        'globaldroptrade-*.service', 'globaldroptrade-*.timer'], text=True,
        capture_output=True, check=True)
    units, seen = [], set()
    for line in (result.stdout+'\n'+active.stdout).splitlines():
        if not line.strip():
            continue
        name = line.split()[0]
        if not re.fullmatch(r'globaldroptrade-[A-Za-z0-9_.@-]+\.(service|timer)', name):
            fail('HOST_TRANSFER_UNIT_NAME_REVIEW_REQUIRED')
        if name in seen:
            continue
        seen.add(name)
        units.append({'name': name, 'activeState': unit_property(name, 'ActiveState'),
                      'unitFileState': unit_property(name, 'UnitFileState')})
    return units


def refuse_busy_jobs(units):
    for row in units:
        name = row['name']
        if name.endswith('.service') and name not in ALLOWED_WORKERS|{'globaldroptrade-api.service'}:
            if unit_property(name, 'ActiveState') not in QUIET:
                fail('HOST_TRANSFER_OTHER_GLOBAL_JOB_ACTIVE')
    result = subprocess.run(['systemctl', 'list-units', '--all', '--no-legend', '--no-pager',
        '--state=running,activating,deactivating', 'global-fresh-reset*.service'],
        text=True, capture_output=True, check=True)
    if result.stdout.strip():
        fail('HOST_TRANSFER_RESET_RUNNING_WAIT_FOR_COMPLETION')


def refuse_unmanaged_jobs(proc=Path('/proc'), root=Path('/')):
    """Inspect identities only; never print cron contents, command lines or credentials."""
    cron_paths = [root/'etc/crontab']
    for directory in ('etc/cron.d', 'var/spool/cron/crontabs', 'var/spool/cron'):
        p = root/directory
        if p.exists():
            cron_paths.extend(p.iterdir())
    marker = re.compile(r'(?:globaldroptrade|/root/global-[^/\s]+(?:/|\b))', re.I)
    for path in cron_paths:
        if path.is_file():
            for line in path.read_text(errors='replace').splitlines():
                if line.strip() and not line.lstrip().startswith('#') and marker.search(line):
                    fail('HOST_TRANSFER_GLOBAL_CRON_REVIEW_REQUIRED')
    ancestors = {os.getpid()}
    parent = os.getppid()
    while parent > 1 and parent not in ancestors:
        ancestors.add(parent)
        try:
            status = (proc/str(parent)/'status').read_text()
            parent = int(re.search(r'^PPid:\s+(\d+)', status, re.M)[1])
        except (OSError, TypeError):
            break
    for path in proc.iterdir():
        if not path.name.isdigit() or int(path.name) in ancestors:
            continue
        try:
            name = (path/'comm').read_text().strip()
            if not re.match(r'^(?:node|nodejs|npm|pnpm|yarn|python|bash|dash|sh)(?:\b|[0-9. ])', name):
                continue
            cwd = os.readlink(path/'cwd')
            command = (path/'cmdline').read_bytes().decode(errors='replace').replace('\x00',' ')
            relevant = marker.search(cwd) or re.match(r'^/root/global-[^/]+', cwd) or marker.search(command)
            if relevant:
                cgroup = (path/'cgroup').read_text()
                units = re.findall(r'/([^/\n]+\.service)(?:/|$)', cgroup, re.M)
                if not any(unit in ALLOWED_WORKERS|{'globaldroptrade-api.service'} for unit in units):
                    fail('HOST_TRANSFER_UNMANAGED_GLOBAL_PROCESS_REVIEW_REQUIRED')
        except (FileNotFoundError, ProcessLookupError):
            continue


def wait_quiet(unit, timeout=180):
    deadline = time.monotonic()+timeout
    while unit_property(unit, 'ActiveState') not in QUIET:
        if time.monotonic() >= deadline:
            fail('HOST_TRANSFER_WORKER_BUSY_RETRY_SAME_COMMAND')
        time.sleep(1)


def freeze(units, run=subprocess.run, wait=wait_quiet):
    definitions = {row['name']:row for row in units}
    names = set(definitions)
    disable_states = {'enabled', 'enabled-runtime', 'linked', 'linked-runtime'}
    def stop_timer(name):
        if definitions[name].get('unitFileState') in disable_states:
            run(['systemctl', 'disable', '--now', name], check=True)
        else:
            run(['systemctl', 'stop', name], check=True)
    failover = 'globaldroptrade-rpc-failover.timer'
    if failover in names:
        stop_timer(failover)
    if 'globaldroptrade-rpc-failover.service' in names:
        wait('globaldroptrade-rpc-failover.service')
    # A completed RPC transition may have re-enabled the daily timer.
    for name in sorted(names):
        if name.endswith('.timer'):
            stop_timer(name)
    for name in sorted(names):
        if name.endswith('.service') and name != 'globaldroptrade-api.service':
            # Disabling never terminates a signer, but prevents an old-host boot start.
            if definitions[name].get('unitFileState') in disable_states:
                run(['systemctl', 'disable', name], check=True)
            if name in ALLOWED_WORKERS:
                wait(name)


def settled_journal(path):
    private(path)
    value = json.loads(path.read_text())
    if not isinstance(value, dict) or value.get('pending') or (
        isinstance(value.get('oracle'), dict) and value['oracle'].get('pending')):
        fail('HOST_TRANSFER_PENDING_JOURNAL_RESUME_SOURCE_FIRST')
    if 'transactions' not in value and 'steps' not in value:
        fail('HOST_TRANSFER_JOURNAL_FORMAT_REVIEW_REQUIRED')
    if 'transactions' in value:
        rows = value['transactions']
        if not isinstance(rows, dict) or any(not isinstance(v, dict) or
            type(v.get('block')) is not int or v['block'] < 1 for v in rows.values()):
            fail('HOST_TRANSFER_PENDING_JOURNAL_RESUME_SOURCE_FIRST')
    if 'steps' in value:
        rows = value['steps']
        if not isinstance(rows, list) or any(not isinstance(v, dict) or
            type(v.get('blockNumber')) is not int or v['blockNumber'] < 1 for v in rows):
            fail('HOST_TRANSFER_PENDING_JOURNAL_RESUME_SOURCE_FIRST')


@contextlib.contextmanager
def financial_locks(base=Path('/var/lib/globaldroptrade'), fallback=Path('/root/global-testnet-v071/.testnet-server')):
    handles = []
    try:
        for path in sorted(base.glob('*/*.lock')):
            private(path)
            fd = os.open(path, os.O_RDWR|os.O_NOFOLLOW)
            handles.append(fd)
            fcntl.flock(fd, fcntl.LOCK_EX|fcntl.LOCK_NB)
        for path in sorted(base.glob('*/journal.json')):
            settled_journal(path)
        for name in ('journal.json', 'deployment-journal.json'):
            p = fallback/name
            if p.exists():
                settled_journal(p)
        yield
    finally:
        for fd in reversed(handles):
            os.close(fd)


REMOTE = r'''
import fcntl,hashlib,json,os,pathlib,platform,shutil,stat,sys,tempfile
base=pathlib.Path('/var/lib/globaldroptrade-host-migration')
data=json.load(sys.stdin)
def die(reason):raise SystemExit(reason)
def private(p,directory=False):
 s=p.lstat()
 if s.st_uid!=0 or s.st_mode&0o077 or not (stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode)):die('HOST_TRANSFER_TARGET_PRIVATE_PATH_REQUIRED')
def save(p,v):
 fd,name=tempfile.mkstemp(prefix='.transfer-',dir=base)
 with os.fdopen(fd,'w') as f:json.dump(v,f,sort_keys=True);f.flush();os.fsync(f.fileno())
 os.replace(name,p)
 fd=os.open(base,os.O_DIRECTORY);os.fsync(fd);os.close(fd)
if os.geteuid()!=0:die('HOST_TRANSFER_TARGET_ROOT_REQUIRED')
if base.resolve()!=base:die('HOST_TRANSFER_TARGET_BASE_SYMLINK')
private(base,True);p=base/'prepared.json';private(p)
marker=json.loads(p.read_text())
if marker.get('version')!=1 or marker.get('destinationIp')!=data['destinationIp'] or marker.get('phase')!='prepared' or marker.get('installRoot')!='/opt/globaldroptrade' or marker.get('sitePort')!=8898:die('HOST_TRANSFER_TARGET_NOT_PREPARED')
if platform.machine()!=data['sourceArchitecture']:die('HOST_TRANSFER_ARCHITECTURE_MISMATCH')
machine=hashlib.sha256(pathlib.Path('/etc/machine-id').read_bytes()).hexdigest()
if machine==data['machineIdHash']:die('HOST_TRANSFER_SOURCE_EQUALS_TARGET')
for name in ('restored.json','restore.json','restore-state.json'):
 if (base/name).exists():die('HOST_TRANSFER_TARGET_ALREADY_RESTORED')
for p in [pathlib.Path(x) for x in ('/etc/globaldroptrade','/var/lib/globaldroptrade','/var/lib/globaldroptrade-api','/var/www/globaldroptrade','/var/backups/globaldroptrade')]:
 if p.exists() or p.is_symlink():die('HOST_TRANSFER_TARGET_LIVE_GLOBAL_PATH_EXISTS')
for p in pathlib.Path('/opt').glob('globaldroptrade-*'):
 if p.name!='globaldroptrade-host-bootstrap':die('HOST_TRANSFER_TARGET_LIVE_GLOBAL_PATH_EXISTS')
import subprocess
r=subprocess.run(['systemctl','list-units','--all','--no-legend','--no-pager','--state=running,activating,deactivating','globaldroptrade-*','global-fresh-reset*'],capture_output=True,text=True,check=True)
if r.stdout.strip():die('HOST_TRANSFER_TARGET_GLOBAL_SERVICE_ACTIVE')
root=base/'import'
if root.exists() or root.is_symlink():private(root,True)
else:root.mkdir(mode=0o700)
manifest=base/'transfer-manifest.json'
prior=None
if manifest.exists():
 private(manifest);prior=json.loads(manifest.read_text())
 if prior.get('sourceId')!=data['sourceId']:die('HOST_TRANSFER_TARGET_OTHER_SOURCE')
elif any(root.iterdir()):die('HOST_TRANSFER_TARGET_UNKNOWN_IMPORT')
if data['action']=='check':
 required=data['sourceBytes']*2+1073741824
 if shutil.disk_usage(base).free<required:die('HOST_TRANSFER_TARGET_NEEDS_IMPORT_AND_RESTORE_SPACE')
 print(json.dumps({'ready':True,'priorPhase':prior.get('phase') if prior else None}));raise SystemExit(0)
if prior and prior.get('phase')=='copied':die('HOST_TRANSFER_TARGET_ALREADY_COPIED_REVIEW_REQUIRED')
value=data['manifest']
if value['sourceId']!=data['sourceId'] or value['destinationIp']!=data['destinationIp']:die('HOST_TRANSFER_MANIFEST_IDENTITY_MISMATCH')
save(manifest,value)
print(json.dumps({'saved':True}))
'''


class Connection:
    def __init__(self, target, port, runtime):
        self.target, self.port, self.runtime = target, port, runtime
        self.options = ['-p', str(port), '-o', 'StrictHostKeyChecking=ask',
            '-o', 'ControlMaster=auto', '-o', 'ControlPersist=600',
            '-o', 'ControlPath='+str(runtime/'ssh'), '-o', 'ConnectTimeout=20']

    def remote(self, data):
        result = subprocess.run(['ssh', *self.options, 'root@'+self.target,
            shlex.join(['python3', '-c', REMOTE])], input=json.dumps(data),
            text=True, stdout=subprocess.PIPE, check=True)
        return json.loads(result.stdout)

    def copy(self, paths, log, *, dry_run=False, initial=False):
        args = ['rsync', '-aHAXR', '--numeric-ids', '--checksum', '--delete-delay',
            '--protect-args', '-e', shlex.join(['ssh', *self.options])]
        if dry_run:
            args += ['--dry-run', '--itemize-changes', '--out-format=%i %n%L']
        args += ['--', *map(str, paths), 'root@'+self.target+':'+REMOTE_BASE+'/import/']
        with log.open('a', opener=lambda p, flags: os.open(p, flags, 0o600)) as stream:
            result = subprocess.run(args, text=True, stdout=subprocess.PIPE if dry_run else stream, stderr=stream)
        if result.returncode not in ((0, 24) if initial else (0,)):
            fail('HOST_TRANSFER_RSYNC_FAILED_PRIVATE_LOG='+str(log))
        if dry_run and result.stdout.strip():
            fail('HOST_TRANSFER_FINAL_COPY_CHANGED_RETRY_SAME_COMMAND')

    def stage_check(self):
        subprocess.run(['ssh', *self.options, 'root@'+self.target,
            shlex.join(['python3', INSTALL_ROOT+'/scripts/host-restore.py',
                        '--stage-check'])], check=True)

    def close(self):
        subprocess.run(['ssh', *self.options, '-O', 'exit', 'root@'+self.target],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)


def source_identity():
    machine = Path('/etc/machine-id').read_bytes()
    hostname = socket.gethostname()
    return {'sourceId': hashlib.sha256(machine+b'\0'+hostname.encode()).hexdigest(),
            'machineIdHash': hashlib.sha256(machine).hexdigest(),
            'sourceHostname': hostname, 'sourceArchitecture': platform.machine()}


def current_config():
    # Return public identity only; the dotenv source is never printed or evaluated.
    text = Path('/etc/globaldroptrade/trades.env').read_text()
    values = {}
    for key in ('TRADES_CHAIN_ID', 'TRADES_VAULT_ADDRESS'):
        matches = re.findall(r'^\s*'+key+r'\s*=\s*(.*?)\s*$', text, re.M)
        if len(matches) != 1:
            fail('HOST_TRANSFER_PUBLIC_CONFIG_REVIEW_REQUIRED')
        values[key] = matches[0].strip().strip('"\'')
    if values['TRADES_CHAIN_ID'] != '97' or not re.fullmatch(r'0x[0-9a-fA-F]{40}', values['TRADES_VAULT_ADDRESS']):
        fail('HOST_TRANSFER_EXISTING_TESTNET_REQUIRED')
    return {'chainId': 97, 'vaultAddress': values['TRADES_VAULT_ADDRESS']}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--execute', action='store_true')
    parser.add_argument('--target', default=DESTINATION)
    parser.add_argument('--port', type=int, default=22)
    args = parser.parse_args(argv)
    if str(ipaddress.IPv4Address(args.target)) != DESTINATION or not 1 <= args.port <= 65535:
        fail('HOST_TRANSFER_EXPECTED_DESTINATION_REQUIRED')
    if os.geteuid() != 0:
        fail('HOST_TRANSFER_SOURCE_ROOT_REQUIRED')
    for command in ('ssh', 'rsync', 'systemctl'):
        if not shutil.which(command):
            fail('HOST_TRANSFER_MISSING_DEPENDENCY_'+command.upper())
    os.umask(0o077)
    LOCAL_BASE.mkdir(mode=0o700, exist_ok=True)
    private(LOCAL_BASE, True)
    lock = LOCAL_BASE/'run.lock'
    fd = os.open(lock, os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW, 0o600)
    private(lock)
    with os.fdopen(fd, 'w') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX|fcntl.LOCK_NB)
        identity = source_identity()
        paths = selected_paths()
        size = inspect_paths(paths)
        units = global_units()
        refuse_busy_jobs(units)
        refuse_unmanaged_jobs()
        api_user = pwd.getpwnam('globaldroptrade-api')
        public_config = current_config()
        request = {**identity, 'destinationIp': args.target, 'sourceBytes': size,
                   'installRoot':INSTALL_ROOT, 'sitePort':SITE_PORT}
        source_release = ''
        if shutil.which('git'):
            source_release = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=REPO,
                text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False).stdout.strip()
        if not re.fullmatch(r'[0-9a-f]{40}', source_release):
            source_release = 'helper-sha256:'+file_hash(Path(__file__))
        state_path = LOCAL_BASE/'session.json'
        state = None
        if state_path.exists():
            private(state_path)
            state = json.loads(state_path.read_text())
            if any(state.get(k) != v for k, v in {'version':1, 'sourceId':identity['sourceId'],
                'destinationIp':args.target, 'port':args.port}.items()):
                fail('HOST_TRANSFER_SOURCE_SESSION_MISMATCH')
        with tempfile.TemporaryDirectory(prefix='global-host-transfer-', dir='/run') as directory:
            connection = Connection(args.target, args.port, Path(directory))
            try:
                remote = connection.remote({**request, 'action':'check'})
                if state and state.get('phase') == 'copied':
                    if remote.get('priorPhase') != 'copied':
                        fail('HOST_TRANSFER_COMPLETED_STATE_MISMATCH')
                    if any(row['activeState'] not in QUIET or row['unitFileState'] in ('enabled','enabled-runtime') for row in units):
                        fail('HOST_TRANSFER_COMPLETED_SOURCE_NOT_FROZEN')
                    if critical_hashes(paths) != state.get('criticalHashes'):
                        fail('HOST_TRANSFER_COMPLETED_SOURCE_STATE_CHANGED')
                    print('HOST_TRANSFER_ALREADY_COPIED_SOURCE_REMAINS_FROZEN')
                    return
                if args.check:
                    print('HOST_TRANSFER_CHECK_PASSED paths='+str(len(paths))+' sourceBytes='+str(size))
                    print('SOURCE_SERVICES_UNCHANGED TARGET_SERVICES_NOT_STARTED')
                    return
                if state is None:
                    state = {'version':1, 'sourceId':identity['sourceId'], 'destinationIp':args.target,
                        'port':args.port, 'phase':'staging', 'sourceUnits':units}
                    atomic_json(state_path, state)
                manifest = {**identity, 'version':1, 'destinationIp':args.target,
                    'installRoot':INSTALL_ROOT, 'sitePort':SITE_PORT,
                    'phase':'staging', 'consistent':False, 'sourceFrozen':False,
                    'sourceStatePath':str(state_path), 'paths':list(map(str, paths)),
                    'apiUser':{'uid':api_user.pw_uid,'gid':api_user.pw_gid},
                    'sourceUnits':state['sourceUnits'], 'sourceRelease':source_release,
                    'sourceConfig':public_config, 'criticalHashes':{}}
                def publish():
                    connection.remote({**request, 'action':'save', 'manifest':manifest})
                publish()
                print('HOST_TRANSFER_INITIAL_COPY_STARTED', flush=True)
                log = LOCAL_BASE/'rsync.log'
                connection.copy(paths, log, initial=True)
                manifest['phase'] = 'staged-live'; publish()
                print('HOST_TRANSFER_DESTINATION_RPC_PREFLIGHT', flush=True)
                connection.stage_check()
                print('HOST_TRANSFER_FREEZING_GLOBAL_ONLY', flush=True)
                state['phase'] = 'freezing'; atomic_json(state_path, state)
                units = global_units()
                refuse_busy_jobs(units)
                refuse_unmanaged_jobs()
                freeze(units)
                refuse_busy_jobs(global_units())
                refuse_unmanaged_jobs()
                with financial_locks():
                    # Only the support API is stopped; financial workers finish naturally.
                    api = next((row for row in units if row['name']=='globaldroptrade-api.service'),None)
                    if api:
                        command = ['systemctl','disable','--now'] if api['unitFileState'] in (
                            'enabled','enabled-runtime','linked','linked-runtime') else ['systemctl','stop']
                        subprocess.run([*command,'globaldroptrade-api.service'],check=True)
                    for row in global_units():
                        if row['activeState'] not in QUIET:
                            fail('HOST_TRANSFER_SOURCE_NOT_QUIET')
                    state['phase'] = 'frozen'; atomic_json(state_path, state)
                    atomic_json(LOCAL_BASE/'frozen.json', {'version':1,
                        'destinationIp':args.target, 'sourceId':identity['sourceId'],
                        'sourceFrozen':True, 'reason':'Global moved; do not re-enable source signing services.'})
                    paths = selected_paths(); inspect_paths(paths)
                    manifest.update(phase='freezing', sourceFrozen=True, paths=list(map(str, paths)))
                    publish()
                    hashes = critical_hashes(paths)
                    print('HOST_TRANSFER_FINAL_COPY_STARTED', flush=True)
                    connection.copy(paths, log)
                    connection.copy(paths, log, dry_run=True)
                    if critical_hashes(paths) != hashes:
                        fail('HOST_TRANSFER_PRIVATE_STATE_CHANGED_RETRY_SAME_COMMAND')
                    manifest.update(phase='copied', consistent=True, criticalHashes=hashes,
                        copiedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
                    publish()
                    state.update(phase='copied', criticalHashes=hashes)
                    atomic_json(state_path, state)
                print('HOST_TRANSFER_COPIED_SOURCE_GLOBAL_FROZEN')
                print('DESTINATION_RESTORE_REQUIRED TARGET_SERVICES_NOT_STARTED')
                print('SOURCE_RECOVERY_STATE='+str(state_path))
                print('OLD_FRONTEND_REMAINS_READABLE; pause deposits until the destination and requested fresh test generation are verified.')
            finally:
                connection.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        reason = str(error) if isinstance(error, RuntimeError) and str(error).startswith('HOST_TRANSFER_') else 'HOST_TRANSFER_STOPPED_REVIEW_REQUIRED'
        print(reason, file=sys.stderr)
        print('SOURCE_RECOVERY_STATE='+str(LOCAL_BASE/'session.json'), file=sys.stderr)
        print('Preserve both hosts, private journals and the source session. Do not start signers on both hosts.', file=sys.stderr)
        sys.exit(1)

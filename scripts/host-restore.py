#!/usr/bin/env python3
"""Restore one fenced Global testnet host snapshot without starting signers."""
import argparse
import configparser
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import posixpath
import pwd
import re
import stat
import subprocess
import sys
import tempfile
import time

BASE = Path('/var/lib/globaldroptrade-host-migration')
DESTINATION = '185.114.206.44'
INSTALL_ROOT = Path('/opt/globaldroptrade')
SITE_PORT = 8898
LAYOUT_VERSION = 2
FIXED_ROOTS = {
    '/etc/globaldroptrade', '/var/lib/globaldroptrade',
    '/var/lib/globaldroptrade-api', '/var/www/globaldroptrade',
    '/var/backups/globaldroptrade', '/root/global-testnet-v071/.testnet-server',
    '/etc/letsencrypt/options-ssl-nginx.conf', '/etc/letsencrypt/ssl-dhparams.pem',
}


def fail(reason):
    raise RuntimeError('HOST_RESTORE_'+reason)


def private(path, directory=False):
    s = path.lstat()
    expected = stat.S_ISDIR if directory else stat.S_ISREG
    if not expected(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o077:
        fail('PRIVATE_INPUT_REQUIRED')


def read_private_json(path):
    private(path)
    value = json.loads(path.read_text())
    if not isinstance(value, dict): fail('OBJECT_REQUIRED')
    return value


def save(path, value):
    fd, name = tempfile.mkstemp(prefix='.'+path.name+'-', dir=path.parent)
    with os.fdopen(fd, 'w') as f:
        json.dump(value, f, sort_keys=True)
        f.flush(); os.fsync(f.fileno())
    os.replace(name, path)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)


def allowed_root(value):
    if not isinstance(value, str) or str(PurePosixPath(value)) != value or '..' in PurePosixPath(value).parts:
        return False
    if value in FIXED_ROOTS: return True
    patterns = (
        r'/opt/globaldroptrade-(?!host-bootstrap$)[A-Za-z0-9_-]+',
        r'/root/global-fresh-reset\.[A-Za-z0-9]+',
        r'/etc/systemd/system/globaldroptrade-[A-Za-z0-9_.@-]+\.(?:service|timer)(?:\.d)?',
        r'/etc/nginx/sites-(?:available|enabled)/globaldroptrade(?:\.com|-ip-[0-9.]+(?:-[0-9]+)?)',
        r'/etc/nginx/snippets/globaldroptrade[A-Za-z0-9_.-]*\.conf',
        r'/etc/letsencrypt/(?:live|archive)/globaldroptrade\.com(?:-[0-9]+)?',
        r'/etc/letsencrypt/renewal/globaldroptrade\.com(?:-[0-9]+)?\.conf',
        r'/etc/letsencrypt/accounts/acme-v02\.api\.letsencrypt\.org/directory/[0-9a-f]{32}',
    )
    return any(re.fullmatch(p, value) for p in patterns)


def covered(value, paths):
    p = PurePosixPath(value)
    return any(p == PurePosixPath(root) or PurePosixPath(root) in p.parents for root in paths)


def imported(import_root, logical):
    return import_root/str(PurePosixPath(logical)).lstrip('/')


def destination_path(logical):
    """Keep legacy source checkouts out of the destination root home."""
    p = PurePosixPath(logical)
    if PurePosixPath('/root') in p.parents:
        return INSTALL_ROOT/'legacy/root'/str(p.relative_to('/root'))
    return Path(logical)


def resolve_import(import_root, logical, paths):
    """Resolve absolute source symlinks inside the import, never on this host."""
    current = posixpath.normpath(str(logical))
    for _ in range(41):
        if not covered(current, paths): fail('SYMLINK_ESCAPES_SELECTED_ROOTS')
        parts = PurePosixPath(current).parts
        replaced = False
        for i in range(1, len(parts)):
            prefix = str(PurePosixPath(*parts[:i+1]))
            candidate = imported(import_root, prefix)
            if candidate.is_symlink():
                target = os.readlink(candidate)
                target = target if target.startswith('/') else posixpath.join(posixpath.dirname(prefix), target)
                current = posixpath.normpath(posixpath.join(target, *parts[i+1:]))
                replaced = True
                break
        if not replaced:
            result = imported(import_root, current)
            if not result.exists(): fail('MISSING_SYMLINK_TARGET')
            return result
    fail('SYMLINK_LOOP')


def validate_tree(import_root, paths):
    for logical in paths:
        root = imported(import_root, logical)
        for parent in root.parents:
            if parent == import_root: break
            if parent.is_symlink() or not parent.is_dir(): fail('UNSAFE_IMPORT_PARENT')
        if not root.exists() and not root.is_symlink(): fail('STAGED_ROOT_MISSING')
        entries = [root]
        if root.is_dir() and not root.is_symlink():
            for directory, dirs, files in os.walk(root, followlinks=False):
                entries += [Path(directory)/name for name in dirs+files]
        for p in entries:
            mode = p.lstat().st_mode
            if stat.S_ISLNK(mode):
                resolve_import(import_root, '/'+str(p.relative_to(import_root)), paths)
            elif not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
                fail('UNSUPPORTED_STAGED_FILE_TYPE')


def digest(path):
    if not stat.S_ISREG(path.lstat().st_mode): fail('HASH_REQUIRES_REGULAR_FILE')
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024*1024), b''): h.update(chunk)
    return h.hexdigest()


def verify_hashes(root, hashes, paths, relocated=False):
    for name, expected in hashes.items():
        if not isinstance(name, str) or not covered(name, paths) or str(PurePosixPath(name)) != name:
            fail('HASH_PATH_INVALID')
        if not isinstance(expected, str) or not re.fullmatch('[0-9a-f]{64}', expected): fail('HASH_INVALID')
        path = imported(root, str(destination_path(name)) if relocated else name)
        for parent in path.parents:
            if parent == root: break
            if parent.is_symlink(): fail('CRITICAL_PATH_SYMLINK_PARENT')
        if digest(path) != expected: fail('SNAPSHOT_HASH_MISMATCH')


def validate_renewal_accounts(stage, paths):
    for logical in paths:
        if not re.fullmatch(r'/etc/letsencrypt/renewal/globaldroptrade\.com(?:-[0-9]+)?\.conf', logical): continue
        parser = configparser.ConfigParser(interpolation=None)
        parser.read_string('[lineage]\n'+imported(stage, logical).read_text())
        if not parser.has_section('renewalparams'): continue
        account = parser.get('renewalparams', 'account', fallback='').strip()
        if not account: continue
        server = parser.get('renewalparams', 'server', fallback='https://acme-v02.api.letsencrypt.org/directory').strip()
        if server != 'https://acme-v02.api.letsencrypt.org/directory' or not re.fullmatch('[0-9a-f]{32}', account):
            fail('RENEWAL_ACCOUNT_REVIEW_REQUIRED')
        directory = '/etc/letsencrypt/accounts/acme-v02.api.letsencrypt.org/directory/'+account
        if directory not in paths: fail('REFERENCED_RENEWAL_ACCOUNT_REQUIRED')
        private(imported(stage, directory), True)
        private(imported(stage, directory+'/private_key.json'))
        if not imported(stage, directory+'/regr.json').is_file(): fail('RENEWAL_REGISTRATION_REQUIRED')


def validate_api_runtime(stage):
    unit = imported(stage, '/etc/systemd/system/globaldroptrade-api.service')
    if not unit.is_file() or unit.is_symlink(): fail('GLOBAL_API_UNIT_REQUIRED')
    files = [unit]
    dropins = unit.with_name(unit.name+'.d')
    if dropins.is_dir(): files += sorted(dropins.glob('*.conf'))
    for path in files:
        if not path.is_file() or path.is_symlink(): fail('GLOBAL_API_UNIT_REQUIRED')
        for line in path.read_text().splitlines():
            if '=' not in line or line.lstrip().startswith(('#',';')): continue
            key, value = line.split('=',1)
            if key.strip().startswith('Exec') or key.strip() in ('WorkingDirectory','EnvironmentFile','RootDirectory'):
                if '/root/' in value or value.strip() == '/root': fail('API_ROOT_RUNTIME_REVIEW_REQUIRED')


def load_snapshot(base, architecture=None, stage_check=False):
    private(base, True)
    prepared = read_private_json(base/'prepared.json')
    if (prepared.get('version') != 1 or prepared.get('destinationIp') != DESTINATION or
        prepared.get('installRoot') != str(INSTALL_ROOT) or prepared.get('sitePort') != SITE_PORT):
        fail('DESTINATION_NOT_PREPARED')
    m = read_private_json(base/'transfer-manifest.json')
    phase_valid = (m.get('phase') == 'staged-live' and m.get('consistent') is False and m.get('sourceFrozen') is False
                   if stage_check else m.get('phase') == 'copied' and m.get('consistent') is True and m.get('sourceFrozen') is True)
    if (m.get('version') != 1 or m.get('destinationIp') != DESTINATION or not phase_valid or
        m.get('installRoot') != str(INSTALL_ROOT) or m.get('sitePort') != SITE_PORT):
        fail('CONSISTENT_FENCED_SNAPSHOT_REQUIRED')
    if m.get('sourceArchitecture') != (architecture or platform.machine()): fail('ARCHITECTURE_MISMATCH')
    if not isinstance(m.get('sourceId'), str) or not re.fullmatch('[0-9a-f]{64}', m['sourceId']): fail('SOURCE_ID_REQUIRED')
    paths = m.get('paths')
    if not isinstance(paths, list) or not paths or len(paths) != len(set(paths)) or not all(allowed_root(x) for x in paths):
        fail('ROOT_ALLOWLIST_REQUIRED')
    if any(a != b and PurePosixPath(a) in PurePosixPath(b).parents for a in paths for b in paths):
        fail('OVERLAPPING_ROOTS')
    if not {'/etc/globaldroptrade', '/var/lib/globaldroptrade', '/var/lib/globaldroptrade-api',
            '/opt/globaldroptrade-api', '/var/www/globaldroptrade'}.issubset(paths):
        fail('ESSENTIAL_ROOTS_REQUIRED')
    hashes = m.get('criticalHashes')
    if not isinstance(hashes, dict) or (not stage_check and '/etc/globaldroptrade/trades.env' not in hashes):
        fail('CRITICAL_HASHES_REQUIRED')
    stage = base/'import'; private(stage, True)
    validate_tree(stage, paths)
    validate_api_runtime(stage)
    validate_renewal_accounts(stage, paths)
    if not stage_check:
        critical_roots = ['/etc/globaldroptrade', '/var/lib/globaldroptrade',
                          '/var/lib/globaldroptrade-api', '/root/global-testnet-v071/.testnet-server']
        critical_roots += [p for p in paths if p.startswith('/etc/letsencrypt/accounts/')]
        for logical in critical_roots:
            directory = imported(stage, logical)
            if logical not in paths: continue
            for p in directory.rglob('*'):
                if p.is_file() and not p.is_symlink() and not p.name.endswith('.lock'):
                    name = '/'+str(p.relative_to(stage))
                    if name not in hashes: fail('CRITICAL_HASH_COVERAGE_REQUIRED')
        verify_hashes(stage, hashes, paths)
    for name in ('/etc/globaldroptrade/trades.env',): private(imported(stage, name))
    for logical in ('/etc/globaldroptrade', '/root/global-testnet-v071/.testnet-server'):
        for p in imported(stage, logical).rglob('*.key'): private(p)
    return m, stage


def call(args, check=True):
    result = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if check and result.returncode: fail('COMMAND_FAILED')
    return result


def inactive_target(allow_api=False):
    out = call(['systemctl', 'list-units', '--all', '--type=service,timer', '--no-legend', '--no-pager',
                '--state=active,activating,deactivating', 'globaldroptrade-*', 'global-fresh-reset-*']).stdout
    for line in out.splitlines():
        fields = line.split()
        if not fields: continue
        name = fields[0].lstrip('●')
        if allow_api and name == 'globaldroptrade-api.service': continue
        fail('TARGET_GLOBAL_UNIT_ACTIVE')


def check_live_parents(path):
    for parent in reversed(path.parents):
        if parent.exists() or parent.is_symlink():
            s = parent.lstat()
            if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o022:
                fail('UNSAFE_LIVE_PARENT')


def preflight_destinations(paths, state):
    owned = set(state.get('restoredPaths', []))
    if state.get('currentPath'): owned.add(state['currentPath'])
    for logical in paths:
        p = destination_path(logical); check_live_parents(p)
        if (p.exists() or p.is_symlink()) and logical not in owned: fail('EXISTING_GLOBAL_PATH_REVIEW_REQUIRED')


RPC_PROBE = r"""
import fs from 'node:fs';import{parseEnv}from'node:util';import{createRequire}from'node:module';
const [envPath,packagePath]=process.argv.slice(1);
const require=createRequire(packagePath);const{FetchRequest,JsonRpcProvider,isAddress}=require('ethers');
const e=parseEnv(fs.readFileSync(envPath,'utf8'));
if(e.TRADES_CHAIN_ID!=='97'||!isAddress(e.TRADES_VAULT_ADDRESS||'')||!e.TRADES_RPC_URL)throw Error('CONFIG');
if(e.TRADES_PORT&&e.TRADES_PORT!=='3115')throw Error('PORT');
const r=new FetchRequest(e.TRADES_RPC_URL);r.timeout=15000;
const p=new JsonRpcProvider(r,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
try{if(Number(await p.send('eth_chainId',[]))!==97)throw Error('CHAIN');
if((await p.getCode(e.TRADES_VAULT_ADDRESS))==='0x'||!await p.getBlock('latest'))throw Error('TARGET');
console.log(JSON.stringify({chainId:97,vaultAddress:e.TRADES_VAULT_ADDRESS,profile:e.TRADES_ZERO_START_PROFILE||''}));}finally{await p.destroy();}
"""


def rpc_probe(stage, paths):
    candidates = sorted(stage.glob('opt/globaldroptrade-node/node-*/bin/node'))
    candidates += sorted(stage.glob('opt/globaldroptrade-runtime/node-*/bin/node'))
    if not candidates: fail('COPIED_NODE_RUNTIME_REQUIRED')
    node = next((p for p in candidates if p.is_file() and os.access(p, os.X_OK)), None)
    if node is None: fail('COPIED_NODE_RUNTIME_REQUIRED')
    api = resolve_import(stage, '/opt/globaldroptrade-api/current', paths)
    result = call([str(node), '--input-type=module', '-e', RPC_PROBE,
                   str(imported(stage, '/etc/globaldroptrade/trades.env')), str(api/'package.json')])
    try: config = json.loads(result.stdout)
    except (ValueError, TypeError): fail('READ_ONLY_RPC_PROOF_REQUIRED')
    if config.get('chainId') != 97: fail('READ_ONLY_RPC_PROOF_REQUIRED')
    profile = config.get('profile')
    if profile == 'global-fresh-fast-test-v1': stem = 'fresh-fast-testnet'
    elif profile in ('', 'global-fresh-zero-v1'): stem = 'fresh-zero'
    else: fail('CONNECTED_PROFILE_REQUIRED')
    report = read_private_json(imported(stage, '/var/lib/globaldroptrade/'+stem+'-v1/deployment-public.json'))
    policy = read_private_json(imported(stage, '/var/lib/globaldroptrade/'+stem+'-automation-v1/daily-policy.json'))
    address = config.get('vaultAddress', '').lower()
    if (report.get('chainId') != 97 or str(report.get('contractAddress', '')).lower() != address or
        policy.get('chainId') != 97 or str(policy.get('vaultAddress', '')).lower() != address):
        fail('CONNECTED_STATE_IDENTITY_MISMATCH')
    return config


def copy_roots(stage, manifest, state, state_file):
    for logical in sorted(manifest['paths'], key=lambda x: (len(PurePosixPath(x).parts), x)):
        state['currentPath'] = logical; save(state_file, state)
        source, target = imported(stage, logical), destination_path(logical)
        check_live_parents(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        if source.is_dir() and not source.is_symlink():
            target.mkdir(mode=source.stat().st_mode & 0o777, exist_ok=True)
            call(['rsync', '-aHAX', '--numeric-ids', '--', str(source)+'/', str(target)+'/'])
        else:
            call(['rsync', '-aHAX', '--numeric-ids', '--', str(source), str(target)])
        if logical not in state['restoredPaths']: state['restoredPaths'].append(logical)
        state.pop('currentPath', None); save(state_file, state)


def relocate_symlinks(stage, paths):
    """Rewrite only copied links whose original resolution changed with relocation."""
    for logical in paths:
        source = imported(stage, logical)
        entries = [source]
        if source.is_dir() and not source.is_symlink():
            for directory, dirs, files in os.walk(source, followlinks=False):
                entries += [Path(directory)/name for name in dirs+files]
        for entry in entries:
            if not entry.is_symlink(): continue
            name = '/'+str(entry.relative_to(stage))
            old_link = os.readlink(entry)
            logical_target = posixpath.normpath(old_link if old_link.startswith('/') else
                                               posixpath.join(posixpath.dirname(name), old_link))
            target = destination_path(logical_target)
            live = destination_path(name)
            new_link = str(target) if old_link.startswith('/') else os.path.relpath(target, live.parent)
            if old_link == new_link: continue
            if not live.is_symlink() or os.readlink(live) not in (old_link, new_link):
                fail('RELOCATED_LINK_REVIEW_REQUIRED')
            if os.readlink(live) == new_link: continue
            fd, name = tempfile.mkstemp(prefix='.host-relocation-', dir=live.parent)
            os.close(fd); temporary = Path(name); temporary.unlink()
            try:
                temporary.symlink_to(new_link)
                os.replace(temporary, live)
                directory = os.open(live.parent, os.O_DIRECTORY)
                try: os.fsync(directory)
                finally: os.close(directory)
            finally:
                if temporary.is_symlink(): temporary.unlink()


def provision_fallback_key(target=None):
    """Preserve the verified legacy deployer without creating a new /root tree."""
    target = Path('/etc/globaldroptrade/migration-deployer.key') if target is None else Path(target)
    if target.exists() or target.is_symlink():
        private(target)
        return
    source = destination_path('/root/global-testnet-v071/.testnet-server/deployer.key')
    if not source.exists(): return
    private(source)
    value = source.read_bytes()
    if not re.fullmatch(rb'(?:0x)?[0-9a-fA-F]{64}', value.strip()): fail('LEGACY_DEPLOYER_KEY_INVALID')
    check_live_parents(target)
    fd, name = tempfile.mkstemp(prefix='.migration-deployer-', dir=target.parent)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(value); f.flush(); os.fsync(f.fileno())
        try: os.link(name, target)
        except FileExistsError: private(target)
        directory = os.open(target.parent, os.O_DIRECTORY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        os.unlink(name)


def disable_signers(manifest):
    names = set()
    for logical in manifest['paths']:
        p = PurePosixPath(logical)
        if p.parent == PurePosixPath('/etc/systemd/system') and re.fullmatch(r'globaldroptrade-[A-Za-z0-9_.@-]+\.(service|timer)', p.name):
            if p.name != 'globaldroptrade-api.service': names.add(p.name)
    for name in sorted(names): call(['systemctl', 'disable', name])


def nginx_verify():
    result = call(['nginx', '-T'])
    if re.search(r'conflicting server name "(?:www\.)?globaldroptrade\.com"', result.stderr):
        fail('NGINX_DOMAIN_CONFLICT')


def healthcheck(config):
    for attempt in range(10):
        r = call(['curl', '--fail', '--silent', '--show-error', '--noproxy', '*', '--max-time', '5',
                  'http://127.0.0.1:3115/api/health'], check=False)
        if r.returncode == 0:
            try:
                if json.loads(r.stdout).get('status') == 'ok': break
            except ValueError: pass
        if attempt == 9: fail('API_HEALTH_FAILED')
        time.sleep(1)
    result = call(['curl', '--fail', '--silent', '--show-error', '--noproxy', '*', '--max-time', '10',
                   'http://127.0.0.1:3115/api/config'])
    try: public = json.loads(result.stdout)
    except ValueError: fail('API_CONFIG_REQUIRED')
    if public.get('chainId') != 97 or str(public.get('vaultAddress', '')).lower() != config['vaultAddress'].lower():
        fail('API_TARGET_MISMATCH')
    certs = list(Path('/etc/letsencrypt/live').glob('globaldroptrade.com*/fullchain.pem'))
    if certs:
        call(['curl', '--fail', '--silent', '--show-error', '--noproxy', '*', '--max-time', '15',
              '--resolve', 'globaldroptrade.com:443:127.0.0.1',
              'https://globaldroptrade.com/api/health'])
    else:
        print('HOST_RESTORE_HTTPS_NOT_VERIFIED_CERTIFICATE_REQUIRED')


def main(args=None):
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--check', action='store_true'); modes.add_argument('--execute', action='store_true')
    modes.add_argument('--stage-check', action='store_true')
    options = parser.parse_args(args)
    if os.geteuid() != 0: fail('ROOT_REQUIRED')
    os.umask(0o077)
    private(BASE, True)
    fd = os.open(BASE/'restore.lock', os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX|fcntl.LOCK_NB)
        manifest, stage = load_snapshot(BASE, stage_check=options.stage_check)
        if options.stage_check:
            inactive_target()
            config = rpc_probe(stage, manifest['paths'])
            print('HOST_STAGE_CHECK_VALID chainId=97 vaultAddress='+config['vaultAddress']); return
        identity = digest(BASE/'transfer-manifest.json')
        state_file = BASE/'restore-state.json'
        if state_file.exists():
            state = read_private_json(state_file)
            if (state.get('version') != 1 or state.get('layoutVersion') != LAYOUT_VERSION or
                state.get('manifestSha256') != identity or state.get('sourceId') != manifest['sourceId']):
                fail('RESTORE_SESSION_MISMATCH')
            if state.get('phase') == 'complete':
                print('HOST_RESTORE_ALREADY_COMPLETE'); return
            if state.get('phase') not in ('copying', 'copied', 'verified', 'api-started'):
                fail('RESTORE_PHASE_INVALID')
        else:
            state = {'version':1, 'layoutVersion':LAYOUT_VERSION, 'manifestSha256':identity,
                     'sourceId':manifest['sourceId'], 'phase':'copying', 'restoredPaths':[]}
        inactive_target(allow_api=state.get('phase') == 'api-started')
        preflight_destinations(manifest['paths'], state)
        config = rpc_probe(stage, manifest['paths'])
        if options.check:
            print('HOST_RESTORE_PREFLIGHT_VALID chainId=97 vaultAddress='+config['vaultAddress']); return
        if not state_file.exists(): save(state_file, state)
        if state.get('phase') == 'copying':
            copy_roots(stage, manifest, state, state_file)
            verify_hashes(Path('/'), manifest['criticalHashes'], manifest['paths'], relocated=True)
            state['phase'] = 'copied'; save(state_file, state)
        if state.get('phase') == 'copied':
            relocate_symlinks(stage, manifest['paths'])
            provision_fallback_key()
            user = pwd.getpwnam('globaldroptrade-api')
            call(['chown', '-R', '--no-dereference', str(user.pw_uid)+':'+str(user.pw_gid), '/var/lib/globaldroptrade-api'])
            call(['systemctl', 'daemon-reload']); disable_signers(manifest)
            nginx_verify()
            state['phase'] = 'verified'; save(state_file, state)
        if state.get('phase') == 'verified':
            nginx_verify()
            state['phase'] = 'api-started'; save(state_file, state)
        if state.get('phase') == 'api-started':
            call(['systemctl', 'enable', 'globaldroptrade-api.service'])
            call(['systemctl', 'start', 'globaldroptrade-api.service'])
            call(['systemctl', 'enable', '--now', 'nginx'])
            call(['systemctl', 'reload', 'nginx'])
            healthcheck(config)
            state.update(phase='complete', completedAt=int(time.time())); save(state_file, state)
        print('HOST_RESTORE_COMPLETE chainId=97 vaultAddress='+config['vaultAddress'])
        print('FINANCIAL_SERVICES_DISABLED=true SOURCE_HOST_PRESERVED=true')
        print('Review the restored target before resuming the separately authorized testnet reset.')


if __name__ == '__main__':
    try: main()
    except Exception as e:
        reason = str(e) if isinstance(e, RuntimeError) and str(e).startswith('HOST_RESTORE_') else 'HOST_RESTORE_FAILED'
        print(reason, file=sys.stderr)
        print('Preserve import and source journals. Do not enable financial services on both hosts.', file=sys.stderr)
        sys.exit(1)

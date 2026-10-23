"""Publish the wallet permission console without changing API or financial services."""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile


spec = importlib.util.spec_from_file_location('global_status_installer', Path(__file__).with_name('install-zero-start-status.py'))
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
ASSETS = ('zero-start-permission.html', 'zero-start-permission.js', 'zero-start-permission-core.js', 'ethers.js', 'style.css')
REDIRECT = 'zero-start-permission.html'
TARGET = '0x23c32bb326db63f89532f80e757b8463c75655b8'


def _entries(prefix, require_status=True):
    root = shared._managed_root(prefix)
    status = prefix/shared.STATUS_RELATIVE
    deploy = root/'deploy'
    shared._safe(deploy, 'directory')
    if stat.S_IMODE(deploy.stat().st_mode) != 0o755:
        raise ValueError('PUBLIC_DEPLOY_PERMISSIONS_REQUIRED')
    if require_status:
        _, _, metadata = shared._managed_entries(root, status)
        if not metadata.is_symlink():
            raise ValueError('EXISTING_READ_ONLY_STATUS_REQUIRED')
        directory = shared._directories(prefix, shared.STATUS_RELATIVE.parent)
        shared._safe(status, 'file')
        if stat.S_IMODE(directory.stat().st_mode) != 0o755 or stat.S_IMODE(status.stat().st_mode) != 0o644:
            raise ValueError('PUBLIC_STATUS_PERMISSIONS_REQUIRED')
        value = json.loads(status.read_text())
        if not isinstance(value, dict) or value.get('version') != 1 or value.get('chainId') != 97 or value.get('kind') != 'fresh-zero-daily-readiness' or str(value.get('target', '')).lower() != TARGET or str(value.get('contractAddress', '')).lower() != TARGET or value.get('siteConnected') is not True:
            raise ValueError('CURRENT_FRESH_TARGET_REQUIRED')
    redirect = deploy/REDIRECT
    if redirect.exists() or redirect.is_symlink():
        shared._safe(redirect, 'file')
    return root, deploy, redirect


def _assets(source):
    source = Path(source)
    shared._safe(source, 'directory')
    result = {}
    for name in ASSETS:
        fd = os.open(source/name, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o022:
                raise ValueError('PERMISSION_CONSOLE_ASSET_REQUIRED')
            with os.fdopen(fd, 'rb', closefd=False) as file:
                result[name] = file.read()
        finally:
            os.close(fd)
    return result


def _private_json(file, value):
    if file.exists() or file.is_symlink():
        raise ValueError('PERMISSION_BACKUP_ALREADY_EXISTS')
    shared._atomic_file(file, (json.dumps(value, indent=2)+'\n').encode(), mode=0o600)


def install_permission_console(backup_dir, source=Path('deployment-console'), prefix=Path('/')):
    prefix = shared._prefix(prefix)
    root, deploy, redirect = _entries(prefix)
    backup = shared._backup_directory(backup_dir, create=True)
    if (backup/'manifest.json').exists() or (backup/'manifest.json').is_symlink():
        raise ValueError('PERMISSION_BACKUP_ALREADY_EXISTS')
    contents = _assets(source)
    digest = hashlib.sha256()
    for name in ASSETS:
        digest.update(name.encode()+b'\0'+contents[name])
    folder = 'zero-permission-'+digest.hexdigest()[:20]
    target = deploy/folder
    if target.exists() or target.is_symlink():
        shared._safe(target, 'directory')
        if stat.S_IMODE(target.stat().st_mode) != 0o755 or {file.name for file in target.iterdir()} != set(ASSETS):
            raise ValueError('EXISTING_PERMISSION_ASSETS_MISMATCH')
        for name, data in contents.items():
            shared._safe(target/name, 'file')
            if stat.S_IMODE((target/name).stat().st_mode) != 0o644 or (target/name).read_bytes() != data:
                raise ValueError('EXISTING_PERMISSION_ASSETS_MISMATCH')
    else:
        temporary = Path(tempfile.mkdtemp(prefix='.zero-permission-assets-', dir=deploy))
        try:
            for name, data in contents.items():
                file = temporary/name
                file.write_bytes(data)
                file.chmod(0o644)
            temporary.chmod(0o755)
            temporary.rename(target)
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)
    url = './'+folder+'/'+REDIRECT
    html = ('<!doctype html><html lang="en" dir="ltr"><meta charset="utf-8">'
            '<meta http-equiv="refresh" content="0;url='+url+'">'
            '<title>Global server permission</title><a href="'+url+'">'
            'Open server permission review</a></html>\n').encode()
    old = ({'kind': 'file', 'bytesBase64': base64.b64encode(redirect.read_bytes()).decode('ascii'),
            'mode': stat.S_IMODE(redirect.stat().st_mode)} if redirect.exists() else {'kind': 'absent'})
    _private_json(backup/'manifest.json', {'version': 1, 'kind': 'zero-start-permission-backup',
                  'webRoot': '/'+str(root.relative_to(prefix)), 'entry': old,
                  'publishedSha256': hashlib.sha256(html).hexdigest()})
    _private_json(backup/'installed.json', {'version': 1, 'folder': folder,
                  'redirectSha256': hashlib.sha256(html).hexdigest(),
                  'assets': {name: hashlib.sha256(data).hexdigest() for name, data in contents.items()}})
    # Publish only after every immutable asset and the private recovery record exist.
    shared._atomic_file(redirect, html)
    return folder


def restore_permission_console(backup_dir, prefix=Path('/')):
    prefix = shared._prefix(prefix)
    root, _, redirect = _entries(prefix, require_status=False)
    backup = shared._backup_directory(backup_dir)
    file = backup/'manifest.json'
    shared._safe(file, 'file')
    if stat.S_IMODE(file.stat().st_mode) != 0o600:
        raise ValueError('PRIVATE_PERMISSION_MANIFEST_REQUIRED')
    manifest = json.loads(file.read_text())
    if not isinstance(manifest, dict) or manifest.get('version') != 1 or manifest.get('kind') != 'zero-start-permission-backup' or manifest.get('webRoot') != '/'+str(root.relative_to(prefix)):
        raise ValueError('PERMISSION_BACKUP_WEB_ROOT_MISMATCH')
    entry = manifest.get('entry')
    if not isinstance(entry, dict) or entry.get('kind') not in ('file', 'absent') or not re.fullmatch('[0-9a-f]{64}', manifest.get('publishedSha256', '')):
        raise ValueError('PERMISSION_BACKUP_ENTRY_INVALID')
    old = None
    if entry['kind'] == 'file':
        mode = entry.get('mode')
        if type(mode) is not int or mode < 0 or mode > 0o777 or mode & 0o022:
            raise ValueError('PERMISSION_BACKUP_ENTRY_INVALID')
        try:
            old = base64.b64decode(entry['bytesBase64'], validate=True)
        except (ValueError, KeyError, TypeError):
            raise ValueError('PERMISSION_BACKUP_ENTRY_INVALID') from None
    if redirect.exists():
        current = hashlib.sha256(redirect.read_bytes()).hexdigest()
        if current != manifest['publishedSha256'] and (old is None or current != hashlib.sha256(old).hexdigest()):
            raise ValueError('PERMISSION_REDIRECT_CHANGED')
    if old is None:
        redirect.unlink(missing_ok=True)
    else:
        shared._atomic_file(redirect, old, mode=entry['mode'])


if __name__ == '__main__':
    try:
        if os.geteuid() != 0:
            raise ValueError('ROOT_REQUIRED')
        parser = argparse.ArgumentParser(description='Install or restore the fixed fresh-contract permission console.')
        modes = parser.add_mutually_exclusive_group(required=True)
        modes.add_argument('--backup-dir', type=Path)
        modes.add_argument('--restore', type=Path)
        args = parser.parse_args()
        if args.restore:
            restore_permission_console(args.restore)
            print('ZERO_START_PERMISSION_ENTRYPOINT_RESTORED')
        else:
            folder = install_permission_console(args.backup_dir)
            print('ZERO_START_PERMISSION_CONSOLE_INSTALLED '+folder)
    except (ValueError, OSError, TypeError):
        raise SystemExit('PERMISSION_CONSOLE_INSTALLATION_STOPPED: managed paths or assets could not be verified')

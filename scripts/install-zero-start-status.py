"""Install the read-only daily status console into the verified managed web root."""
import datetime
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import stat
import tempfile


ASSETS = ('zero-start-activation.html', 'zero-start-activation.js', 'ethers.js', 'style.css')
STATUS_RELATIVE = Path('var/www/globaldroptrade/automation-data/activation.json')


def _safe(path, kind):
    info = path.lstat()
    valid = stat.S_ISREG(info.st_mode) if kind == 'file' else stat.S_ISDIR(info.st_mode)
    if not valid or info.st_uid != os.geteuid() or info.st_mode & 0o022:
        raise ValueError('UNSAFE_STATUS_CONSOLE_PATH')


def _directories(prefix, relative, create=False, mode=0o755):
    current = prefix
    for part in Path(relative).parts:
        if part in ('', '.', '..') or '/' in part:
            raise ValueError('UNEXPECTED_STATUS_CONSOLE_PATH')
        current /= part
        if create and not current.exists() and not current.is_symlink():
            permissions = mode if current == prefix/relative else 0o755
            current.mkdir(mode=permissions)
            current.chmod(permissions)
        _safe(current, 'directory')
    return current


def _roots(text):
    lexer = shlex.shlex(text, posix=True, punctuation_chars='{};')
    lexer.whitespace_split = True
    lexer.commenters = '#'
    tokens = []
    for token in lexer:
        tokens.extend(token if token and all(c in '{};' for c in token) else [token])
    roots = set()
    for index, token in enumerate(tokens):
        if token != 'root' or (index and tokens[index-1] not in '{};'):
            continue
        if index+2 >= len(tokens) or tokens[index+2] != ';':
            raise ValueError('ONE_MANAGED_WEB_ROOT_REQUIRED')
        roots.add(tokens[index+1])
    return roots


def _managed_root(prefix):
    for name in ('etc', 'etc/nginx', 'etc/nginx/sites-available', 'etc/nginx/sites-enabled'):
        _directories(prefix, Path(name))
    conf = prefix/'etc/nginx/sites-available/globaldroptrade.com'
    enabled = prefix/'etc/nginx/sites-enabled/globaldroptrade.com'
    _safe(conf, 'file')
    if not enabled.is_symlink() or enabled.lstat().st_uid != os.geteuid() or enabled.resolve(strict=True) != conf:
        raise ValueError('ACTIVE_MANAGED_NGINX_CONFIGURATION_REQUIRED')
    roots = _roots(conf.read_text())
    if len(roots) != 1:
        raise ValueError('ONE_MANAGED_WEB_ROOT_REQUIRED')
    web_path = next(iter(roots))
    if not re.fullmatch(r'/var/www/globaldroptrade/releases/[A-Za-z0-9][A-Za-z0-9._-]*', web_path):
        raise ValueError('ONE_MANAGED_WEB_ROOT_REQUIRED')
    root = _directories(prefix, Path(web_path.lstrip('/')))
    _safe(root/'index.html', 'file')
    return root


def _asset_bytes(source):
    if source.is_symlink() or not source.is_dir():
        raise ValueError('STATUS_CONSOLE_SOURCE_REQUIRED')
    contents = {}
    for name in ASSETS:
        fd = os.open(source/name, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise ValueError('STATUS_CONSOLE_ASSET_REQUIRED')
            with os.fdopen(fd, 'rb', closefd=False) as file:
                contents[name] = file.read()
        finally:
            os.close(fd)
    return contents


def _atomic_file(destination, contents, mode=0o644):
    fd, temporary = tempfile.mkstemp(prefix='.zero-status-file-', dir=destination.parent)
    try:
        with os.fdopen(fd, 'wb') as file:
            file.write(contents)
            file.flush()
            os.fsync(file.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _prefix(value):
    prefix = Path(value)
    if not prefix.is_absolute() or '..' in prefix.parts or prefix.is_symlink() or prefix.resolve() != prefix:
        raise ValueError('ABSOLUTE_STATUS_PREFIX_REQUIRED')
    return prefix


def _managed_entries(root, status):
    deploy = root/'deploy'
    if deploy.exists() or deploy.is_symlink():
        _safe(deploy, 'directory')
        if stat.S_IMODE(deploy.stat().st_mode) != 0o755:
            raise ValueError('PUBLIC_DEPLOY_PERMISSIONS_REQUIRED')
    redirect, metadata = deploy/'zero-start-activation.html', deploy/'zero-start-activation.json'
    if redirect.exists() or redirect.is_symlink():
        _safe(redirect, 'file')
    if metadata.exists() or metadata.is_symlink():
        if not metadata.is_symlink() or metadata.lstat().st_uid != os.geteuid() or os.readlink(metadata) != str(status):
            raise ValueError('UNEXPECTED_STATUS_METADATA_ENTRY')
    return deploy, redirect, metadata


def _atomic_link(destination, target):
    temporary = Path(tempfile.mkdtemp(prefix='.zero-status-link-', dir=destination.parent))
    try:
        link = temporary/'metadata'
        link.symlink_to(target)
        os.replace(link, destination)
    finally:
        shutil.rmtree(temporary)


def _backup_directory(directory, create=False):
    directory = Path(directory)
    if not directory.is_absolute() or '..' in directory.parts or directory.resolve() != directory:
        raise ValueError('PRIVATE_STATUS_BACKUP_REQUIRED')
    if create:
        existed = directory.exists()
        directory.mkdir(parents=True, mode=0o700, exist_ok=True)
        if not existed:
            directory.chmod(0o700)
    _safe(directory, 'directory')
    if stat.S_IMODE(directory.stat().st_mode) != 0o700:
        raise ValueError('PRIVATE_STATUS_BACKUP_REQUIRED')
    return directory


def _snapshot(root, prefix, redirect, metadata, backup_dir):
    backup = _backup_directory(backup_dir, create=True)
    manifest_file = backup/'manifest.json'
    if manifest_file.exists() or manifest_file.is_symlink():
        raise ValueError('STATUS_BACKUP_ALREADY_EXISTS')
    entries = {}
    entries[redirect.name] = ({'kind': 'file', 'bytesBase64': base64.b64encode(redirect.read_bytes()).decode('ascii'),
                               'mode': stat.S_IMODE(redirect.stat().st_mode)} if redirect.exists() else {'kind': 'absent'})
    entries[metadata.name] = {'kind': 'symlink', 'linkTarget': os.readlink(metadata)} if metadata.is_symlink() else {'kind': 'absent'}
    manifest = {'version': 1, 'kind': 'zero-start-status-backup', 'webRoot': '/'+str(root.relative_to(prefix)), 'entries': entries}
    _atomic_file(manifest_file, (json.dumps(manifest, indent=2)+'\n').encode(), mode=0o600)


def restore_status_console(backup_dir, prefix=Path('/')):
    prefix = _prefix(prefix)
    root = _managed_root(prefix)
    backup = _backup_directory(backup_dir)
    manifest_file = backup/'manifest.json'
    _safe(manifest_file, 'file')
    if stat.S_IMODE(manifest_file.stat().st_mode) != 0o600:
        raise ValueError('PRIVATE_STATUS_MANIFEST_REQUIRED')
    manifest = json.loads(manifest_file.read_text())
    if not isinstance(manifest, dict) or manifest.get('version') != 1 or manifest.get('kind') != 'zero-start-status-backup' or manifest.get('webRoot') != '/'+str(root.relative_to(prefix)):
        raise ValueError('STATUS_BACKUP_WEB_ROOT_MISMATCH')
    deploy, redirect, metadata = _managed_entries(root, prefix/STATUS_RELATIVE)
    entries = manifest.get('entries')
    if not isinstance(entries, dict) or set(entries) != {redirect.name, metadata.name}:
        raise ValueError('STATUS_BACKUP_ENTRIES_INVALID')
    old_redirect, old_metadata = entries[redirect.name], entries[metadata.name]
    if not isinstance(old_redirect, dict) or old_redirect.get('kind') not in ('file', 'absent'):
        raise ValueError('STATUS_BACKUP_ENTRIES_INVALID')
    redirect_bytes = None
    if old_redirect['kind'] == 'file':
        mode = old_redirect.get('mode')
        if type(mode) is not int or mode < 0 or mode > 0o777 or mode & 0o022:
            raise ValueError('STATUS_BACKUP_ENTRIES_INVALID')
        try:
            redirect_bytes = base64.b64decode(old_redirect['bytesBase64'], validate=True)
        except (ValueError, KeyError, TypeError):
            raise ValueError('STATUS_BACKUP_ENTRIES_INVALID') from None
    if not isinstance(old_metadata, dict) or old_metadata.get('kind') not in ('symlink', 'absent'):
        raise ValueError('STATUS_BACKUP_ENTRIES_INVALID')
    if old_metadata['kind'] == 'symlink' and old_metadata.get('linkTarget') != str(prefix/STATUS_RELATIVE):
        raise ValueError('STATUS_BACKUP_METADATA_TARGET_INVALID')
    if not deploy.exists():
        if old_redirect['kind'] == 'absent' and old_metadata['kind'] == 'absent':
            return
        deploy.mkdir(mode=0o755)
        deploy.chmod(0o755)
    # Validate both entries before restoring either; never unlink an unexpected metadata file.
    if old_metadata['kind'] == 'absent':
        if metadata.is_symlink():
            metadata.unlink()
    else:
        _atomic_link(metadata, old_metadata['linkTarget'])
    if old_redirect['kind'] == 'absent':
        if redirect.exists():
            redirect.unlink()
    else:
        _atomic_file(redirect, redirect_bytes, mode=old_redirect['mode'])


def install_status_console(source=Path('deployment-console'), prefix=Path('/'), backup_dir=None):
    source, prefix = Path(source), _prefix(prefix)
    root = _managed_root(prefix)
    status_root = _directories(prefix, STATUS_RELATIVE.parent)
    status = prefix/STATUS_RELATIVE
    _safe(status, 'file')
    if stat.S_IMODE(status_root.stat().st_mode) != 0o755 or stat.S_IMODE(status.stat().st_mode) != 0o644:
        raise ValueError('PUBLIC_STATUS_PERMISSIONS_REQUIRED')
    contents = _asset_bytes(source)
    digest = hashlib.sha256()
    for name in ASSETS:
        digest.update(name.encode()+b'\0'+contents[name])
    folder = 'zero-status-'+digest.hexdigest()[:20]
    deploy, redirect, metadata = _managed_entries(root, status)
    target = deploy/folder
    if target.exists() or target.is_symlink():
        _safe(target, 'directory')
        if stat.S_IMODE(target.stat().st_mode) != 0o755 or {file.name for file in target.iterdir()} != set(ASSETS):
            raise ValueError('EXISTING_STATUS_ASSETS_MISMATCH')
        for name in ASSETS:
            _safe(target/name, 'file')
            if stat.S_IMODE((target/name).stat().st_mode) != 0o644 or (target/name).read_bytes() != contents[name]:
                raise ValueError('EXISTING_STATUS_ASSETS_MISMATCH')
    else:
        deploy.mkdir(mode=0o755, exist_ok=True)
        deploy.chmod(0o755)
        temporary = Path(tempfile.mkdtemp(prefix='.zero-status-assets-', dir=deploy))
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
    url = './'+folder+'/zero-start-activation.html'
    html = ('<!doctype html><html lang="en" dir="ltr"><meta charset="utf-8">'
            '<meta http-equiv="refresh" content="0;url='+url+'">'
            '<title>Global daily plan status</title><a href="'+url+'">'
            'Open the read-only daily plan status</a></html>\n').encode()
    if backup_dir is not None:
        _snapshot(root, prefix, redirect, metadata, backup_dir)
    if redirect.exists() and (redirect.read_bytes() != html or stat.S_IMODE(redirect.stat().st_mode) != 0o644):
        backup_root = _directories(prefix, Path('var/backups/globaldroptrade'), create=True, mode=0o700)
        backup = backup_root/('zero-status-console-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%f'))
        backup.mkdir(mode=0o700)
        old = backup/redirect.name
        fd = os.open(old, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as file:
            file.write(redirect.read_bytes())
            file.flush()
            os.fsync(file.fileno())
    if not metadata.is_symlink():
        _atomic_link(metadata, status)
    if not redirect.exists() or redirect.read_bytes() != html or stat.S_IMODE(redirect.stat().st_mode) != 0o644:
        _atomic_file(redirect, html)
    return folder


if __name__ == '__main__':
    try:
        if os.geteuid() != 0:
            raise ValueError('ROOT_REQUIRED')
        parser = argparse.ArgumentParser(description='Install or restore the read-only daily status entrypoints.')
        modes = parser.add_mutually_exclusive_group()
        modes.add_argument('--backup-dir', type=Path)
        modes.add_argument('--restore', type=Path)
        args = parser.parse_args()
        if args.restore:
            restore_status_console(args.restore)
            print('ZERO_START_STATUS_ENTRYPOINTS_RESTORED')
        else:
            installed = install_status_console(backup_dir=args.backup_dir)
            print('ZERO_START_READ_ONLY_STATUS_INSTALLED '+installed)
            print('https://globaldroptrade.com/deploy/zero-start-activation.html')
    except (ValueError, OSError):
        raise SystemExit('STATUS_CONSOLE_INSTALLATION_STOPPED: managed paths or read-only assets could not be verified')

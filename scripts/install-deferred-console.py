"""Install content-addressed owner-console assets into the managed web release."""
import datetime
import hashlib
import os
from pathlib import Path
import re
import shutil
import tempfile


def install_console(source=Path('deployment-console'), prefix=Path('/')):
    conf = prefix/'etc/nginx/sites-available/globaldroptrade.com'
    enabled = prefix/'etc/nginx/sites-enabled/globaldroptrade.com'
    if not conf.is_file() or not enabled.is_symlink() or enabled.resolve() != conf.resolve():
        raise ValueError('ACTIVE_MANAGED_NGINX_CONFIGURATION_REQUIRED')
    roots = set(re.findall(r'^\s*root\s+(/var/www/globaldroptrade/releases/[^;\s]+);', conf.read_text(), re.M))
    if len(roots) != 1:
        raise ValueError('ONE_MANAGED_WEB_ROOT_REQUIRED')
    root = prefix/roots.pop().lstrip('/')
    if root.is_symlink() or not root.is_dir() or root.resolve().parent != (prefix/'var/www/globaldroptrade/releases').resolve():
        raise ValueError('UNEXPECTED_WEB_ROOT')
    deploy = root/'deploy'
    if deploy.is_symlink():
        raise ValueError('UNEXPECTED_DEPLOY_SYMLINK')
    names = ['deferred-migration.html', 'deferred-migration.js', 'deferred-migration-core.js',
             'deferred-wallet-journal.js', 'TestnetDeferredMigrationVault.json', 'ethers.js', 'style.css']
    names += [str(p.relative_to(source)) for p in sorted((source/'wallet-bundle').rglob('*')) if p.is_file()]
    if not any(n.endswith('/wallet-client.js') for n in names):
        raise ValueError('WALLET_BUNDLE_MISSING')
    digest = hashlib.sha256()
    for name in names:
        file = source/name
        if file.is_symlink() or not file.is_file():
            raise ValueError('CONSOLE_ASSET_MISSING')
        digest.update(name.encode()+b'\0'+file.read_bytes())
    folder = 'deferred-'+digest.hexdigest()[:20]
    deploy.mkdir(mode=0o755, exist_ok=True)
    target = deploy/folder
    if target.exists() or target.is_symlink():
        if target.is_symlink() or not target.is_dir() or any((target/n).is_symlink() or not (target/n).is_file() or (target/n).read_bytes() != (source/n).read_bytes() for n in names):
            raise ValueError('EXISTING_CONSOLE_ASSET_MISMATCH')
    else:
        temporary = Path(tempfile.mkdtemp(prefix='.deferred-install-', dir=deploy))
        try:
            for name in names:
                dest = temporary/name
                dest.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
                shutil.copyfile(source/name, dest)
                dest.chmod(0o644)
            temporary.chmod(0o755)
            temporary.rename(target)
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)
    redirect = deploy/'deferred-migration.html'
    if redirect.is_symlink():
        raise ValueError('UNEXPECTED_CONSOLE_REDIRECT_SYMLINK')
    if redirect.exists():
        backup = prefix/'var/backups/globaldroptrade'/('deferred-console-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%f'))
        backup.mkdir(mode=0o700, parents=True)
        shutil.copy2(redirect, backup/redirect.name)
    url = './'+folder+'/deferred-migration.html'
    html = '<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url='+url+'"><title>Global testnet migration</title><a href="'+url+'">Open the reviewed owner console</a></html>\n'
    fd, filename = tempfile.mkstemp(prefix='.deferred-redirect-', dir=deploy)
    try:
        with os.fdopen(fd, 'w') as out:
            out.write(html)
            out.flush()
            os.fsync(out.fileno())
        os.chmod(filename, 0o644)
        os.replace(filename, redirect)
    finally:
        if os.path.exists(filename):
            os.unlink(filename)
    return folder


if __name__ == '__main__':
    try:
        install_console()
        print('DEFERRED_OWNER_CONSOLE_INSTALLED')
        print('https://globaldroptrade.com/deploy/deferred-migration.html')
    except (ValueError, OSError):
        raise SystemExit('CONSOLE_INSTALLATION_STOPPED: managed paths or reviewed assets could not be verified')

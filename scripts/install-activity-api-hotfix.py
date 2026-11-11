#!/usr/bin/env python3
"""Guarded, reversible hotfix of the testnet activity API. No chain writes."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path('/opt/globaldroptrade-api')
OLD_SHA = '5bfea93b6d020d6e67c2d9de074c525de4bcc5244891d39b1cc20f5b8b90ef87'
FIRST_SHA = 'b7d09dc23d2e26b39998ad52086bade59988a0f04aae83b754149a42ac9e307e'
FIX_SHA = 'a96d30e8b3c0e0610a823eaaf2aee69a66c6630147e1f07250b27207bb57fa92'
# This is the unchanged API entrypoint: it does not enable proxy-header trust.
API_SHA = '85bf9fce73d1cfc991ce67556939671a14afd17dab01e08bc2192bb2cfadf44a'
TARGET = '0x4c0f6141b18971db4b14e45c0be8cddb09febc14'
SERVICE = 'globaldroptrade-api.service'
ROOT_SOURCE = Path(__file__).resolve().parent.parent / 'server/daily-activity.mjs'
URL = 'http://127.0.0.1:3115'


def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def command(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=30).stdout.strip()


def fetch(path):
    req = urllib.request.Request(URL + path, headers={'Cache-Control': 'no-store'})
    with urllib.request.urlopen(req, timeout=10) as response:
        if response.status != 200:
            raise RuntimeError('ACTIVITY_API_HTTP_FAILED')
        return json.load(response)


def validate_config(config):
    if config.get('version') != 1 or config.get('chainId') != 97 or str(config.get('vaultAddress', '')).lower() != TARGET:
        raise RuntimeError('ACTIVITY_API_TARGET_MISMATCH')


def validate_activity(value):
    if value.get('version') != 1 or value.get('chainId') != 97 or str(value.get('vaultAddress', '')).lower() != TARGET or value.get('wallet') != '0x0000000000000000000000000000000000000001' or value.get('requirementEnabled') is not True:
        raise RuntimeError('ACTIVITY_API_STATUS_MISMATCH')


def verify_http(*, allow_limited=False):
    validate_config(fetch('/api/config'))
    try:
        validate_activity(fetch('/api/daily-activity/status?wallet=0x0000000000000000000000000000000000000001'))
    except urllib.error.HTTPError as error:
        # An exhausted shared peer limit can block this check. Configuration is
        # still independently validated above, and post-restart must be HTTP 200.
        if not allow_limited or error.code != 429:
            raise


def verified_path():
    releases = ROOT / 'releases'
    for parent in (ROOT, releases):
        s = parent.lstat()
        if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o022:
            raise RuntimeError('ACTIVITY_API_DIRECTORY_UNSAFE')
    link = ROOT / 'current'
    if not link.is_symlink():
        raise RuntimeError('ACTIVITY_API_LINK_REQUIRED')
    old = link.resolve(strict=True)
    if old.parent != releases.resolve(strict=True) or not old.is_dir():
        raise RuntimeError('ACTIVITY_API_RELEASE_UNSAFE')
    for directory in (old, old / 'server'):
        s = directory.lstat()
        if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o022:
            raise RuntimeError('ACTIVITY_API_RELEASE_UNSAFE')
    source = old / 'server/daily-activity.mjs'
    src_stat = source.lstat()
    if not stat.S_ISREG(src_stat.st_mode) or src_stat.st_uid != 0 or src_stat.st_mode & 0o022 or sha(source) not in (OLD_SHA, FIRST_SHA, FIX_SHA):
        raise RuntimeError('ACTIVITY_API_VERSION_MISMATCH')
    api = old / 'server/trades-api.mjs'
    api_stat = api.lstat()
    if not stat.S_ISREG(api_stat.st_mode) or api_stat.st_uid != 0 or api_stat.st_mode & 0o022 or sha(api) != API_SHA:
        raise RuntimeError('ACTIVITY_API_ENTRYPOINT_MISMATCH')
    if sha(ROOT_SOURCE) != FIX_SHA:
        raise RuntimeError('ACTIVITY_API_PATCH_MISMATCH')
    if command('systemctl', 'is-active', SERVICE) != 'active':
        raise RuntimeError('ACTIVITY_API_SERVICE_INACTIVE')
    workdir = command('systemctl', 'show', SERVICE, '-p', 'WorkingDirectory', '--value')
    executable = command('systemctl', 'show', SERVICE, '-p', 'ExecStart', '--value')
    expected_file = str(ROOT / 'current/server/trades-api.mjs')
    if workdir != str(ROOT / 'current') or expected_file not in executable:
        raise RuntimeError('ACTIVITY_API_UNIT_MISMATCH')
    verify_http(allow_limited=True)
    return old


def switch(target):
    current = ROOT / 'current'
    temp = ROOT / ('.activity-api-link-' + str(os.getpid()))
    try:
        os.symlink(str(target), temp)
        os.replace(temp, current)
    finally:
        if temp.is_symlink():
            temp.unlink()


def run(mode):
    if os.geteuid() != 0:
        raise RuntimeError('ACTIVITY_API_ROOT_REQUIRED')
    old = verified_path()
    original_sha = sha(old / 'server/daily-activity.mjs')
    print('ACTIVITY_API_PREFLIGHT_PASSED', flush=True)
    if mode == '--check':
        return
    if original_sha == FIX_SHA:
        print('ACTIVITY_API_ALREADY_INSTALLED')
        return
    if original_sha not in (OLD_SHA, FIRST_SHA):
        raise RuntimeError('ACTIVITY_API_VERSION_MISMATCH')
    # No destructive operation: preserve the immutable old release and data.
    new = Path(tempfile.mkdtemp(prefix='activity-fix-', dir=ROOT / 'releases'))
    switched = False
    try:
        shutil.copytree(old, new, symlinks=True, dirs_exist_ok=True)
        new.chmod(0o755)
        dest = new / 'server/daily-activity.mjs'
        if dest.is_symlink() or sha(dest) != original_sha:
            raise RuntimeError('ACTIVITY_API_COPY_MISMATCH')
        shutil.copyfile(ROOT_SOURCE, dest)
        dest.chmod(0o644)
        if sha(dest) != FIX_SHA:
            raise RuntimeError('ACTIVITY_API_PATCH_MISMATCH')
        command('node', '--check', str(dest))
        # Recheck the service and public target immediately before switching.
        if verified_path() != old or sha(old / 'server/daily-activity.mjs') != original_sha:
            raise RuntimeError('ACTIVITY_API_RELEASE_CHANGED')
        switch(new)
        switched = True
        command('systemctl', 'restart', SERVICE)
        for attempt in range(10):
            try:
                if command('systemctl', 'is-active', SERVICE) == 'active':
                    verify_http()
                    break
            except Exception:
                pass
            time.sleep(1)
        else:
            raise RuntimeError('ACTIVITY_API_POSTCHECK_FAILED')
        print('ACTIVITY_API_HOTFIX_INSTALLED')
        print('OLD_RELEASE_PRESERVED', old)
        print('NO_SIGNED_ACTIVITY_OR_PAYMENT_TESTED')
    except BaseException:
        if switched:
            try:
                switch(old)
                command('systemctl', 'restart', SERVICE)
                verify_http()
                print('ACTIVITY_API_ROLLBACK_COMPLETED')
            except Exception:
                print('ACTIVITY_API_ROLLBACK_FAILED')
        raise


def main():
    import sys
    if len(sys.argv) != 2 or sys.argv[1] not in ('--check', '--execute'):
        raise RuntimeError('ACTIVITY_API_EXPLICIT_MODE_REQUIRED')
    # Keep simultaneous hotfix executions from racing one another. The active
    # release is rechecked immediately before the atomic link replacement.
    if os.geteuid() != 0:
        raise RuntimeError('ACTIVITY_API_ROOT_REQUIRED')
    root = ROOT.lstat()
    if not stat.S_ISDIR(root.st_mode) or root.st_uid != 0 or root.st_mode & 0o022:
        raise RuntimeError('ACTIVITY_API_DIRECTORY_UNSAFE')
    fd = os.open(ROOT / '.activity-api-hotfix.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        lock = os.fstat(fd)
        if not stat.S_ISREG(lock.st_mode) or lock.st_uid != 0 or lock.st_nlink != 1 or lock.st_mode & 0o077:
            raise RuntimeError('ACTIVITY_API_LOCK_UNSAFE')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        run(sys.argv[1])
    finally:
        os.close(fd)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        message = str(error)
        print(message if message.startswith('ACTIVITY_API_') else 'ACTIVITY_API_STOPPED')
        raise SystemExit(1)

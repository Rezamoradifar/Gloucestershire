#!/usr/bin/env python3
"""Stage and switch public-code releases without opening any financial files."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import time

baseline = {
    'scripts/connect-zero-start.mjs': '4d2672a2f55c71e7d848c9d988951af3405187d14dcf5833070710219afa0236',
    'scripts/daily-profit.mjs': '52d8e00ef4fa10e541dffad7d33357f90300bb19513c2ed81055cac9f1a1351b',
    'server/trades-api.mjs': '054d954663811ee30096b7e54b548454e7fbf6d1b4787a00f763aa33fd63035d',
}
helper = 'scripts/complete-rpc-logs.mjs'
previous_helper_hashes = {
    'cc86f8004253b5c5f7aa20292ee6151da9140bf18994e1a36661ac04b1f52b14',
    '1ed98c3709a7980fa79abecd740001fd429f707e3541162e3fea943ee7737346',
}
previous_source_hashes = {'scripts/daily-profit.mjs': {'a1f0d70d10affb6b9f762cf5fb04e249ca428bc3ac2d78f6c45e64a74b5dda37'}}
roles = {'api': ['server/trades-api.mjs', helper], 'daily': [*baseline, helper]}


def public_directory(directory):
    metadata = Path(directory).lstat()
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
        raise ValueError('TRUSTED_LOG_READER_DIRECTORY_REQUIRED')


def digest(file, missing=False):
    try:
        descriptor = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        if missing:
            return None
        raise
    with os.fdopen(descriptor, 'rb') as source:
        metadata = os.fstat(source.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
            raise ValueError('TRUSTED_LOG_READER_SOURCE_REQUIRED')
        return hashlib.sha256(source.read()).hexdigest()


def write_manifest(file, report):
    descriptor = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'w') as output:
        json.dump(report, output)
        output.write('\n')
        output.flush()
        os.fsync(output.fileno())


def read_manifest(file):
    descriptor = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor) as source:
        metadata = os.fstat(source.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or stat.S_IMODE(metadata.st_mode) != 0o600:
            raise ValueError('PRIVATE_LOG_READER_MANIFEST_REQUIRED')
        report = json.load(source)
    if report.get('version') != 1 or report.get('kind') != 'zero-log-reader-releases' or set(report.get('roles', {})) != set(roles):
        raise ValueError('LOG_READER_MANIFEST_REQUIRED')
    return report


def verify_files(directory, expected):
    for relative, expected_hash in expected.items():
        if digest(Path(directory) / relative, missing=True) != expected_hash:
            raise ValueError('LOG_READER_RELEASE_CHANGED')


def prepare(source, api_current, daily_current, manifest):
    source = Path(source)
    public_directory(source)
    report = {'version': 1, 'kind': 'zero-log-reader-releases', 'roles': {}}
    stamp = time.strftime('%Y%m%dT%H%M%S', time.gmtime()) + '-' + str(os.getpid())
    for role, current in [('api', Path(api_current)), ('daily', Path(daily_current))]:
        if not current.is_symlink() or current.lstat().st_uid != 0:
            raise ValueError('MANAGED_LOG_READER_RELEASE_REQUIRED')
        previous = current.resolve(strict=True)
        releases = current.parent / 'releases'
        public_directory(current.parent)
        public_directory(releases)
        public_directory(previous)
        if previous.parent != releases.resolve(strict=True) or not previous.is_dir():
            raise ValueError('MANAGED_LOG_READER_RELEASE_REQUIRED')
        for name in ('scripts', 'server'):
            public_directory(previous / name)
            public_directory(source / name)
        new_hashes = {relative: digest(source / relative) for relative in roles[role]}
        old_hashes = {relative: digest(previous / relative, missing=True) for relative in roles[role]}
        for relative, old_hash in old_hashes.items():
            if old_hash == new_hashes[relative]:
                continue
            if relative == helper and (old_hash is None or old_hash in previous_helper_hashes):
                continue
            if old_hash in previous_source_hashes.get(relative, set()):
                continue
            if old_hash != baseline.get(relative):
                raise ValueError('INSTALLED_LOG_READER_SOURCE_REVIEW_REQUIRED')
        next_release = previous
        if old_hashes != new_hashes:
            next_release = releases / ('log-readers-' + stamp)
            shutil.copytree(previous, next_release, symlinks=True)
            os.chmod(next_release, 0o755)
            for relative in roles[role]:
                target = next_release / relative
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
                if target.is_symlink():
                    raise ValueError('TRUSTED_LOG_READER_SOURCE_REQUIRED')
                shutil.copyfile(source / relative, target)
                target.chmod(0o644)
            verify_files(previous, old_hashes)
            verify_files(next_release, new_hashes)
        report['roles'][role] = {'current': str(current), 'previous': str(previous), 'next': str(next_release), 'oldHashes': old_hashes, 'newHashes': new_hashes}
    write_manifest(manifest, report)


def move_link(current, target):
    current = Path(current)
    temporary = current.with_name('log-reader-link-' + str(os.getpid()))
    os.symlink(target, temporary)
    try:
        os.replace(temporary, current)
        descriptor = os.open(current.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if temporary.is_symlink():
            temporary.unlink()


def switch(manifest, restore=False):
    report = read_manifest(manifest)
    for item in report['roles'].values():
        current = Path(item['current'])
        if not current.is_symlink() or str(current.resolve(strict=True)) not in (item['previous'], item['next']):
            raise ValueError('LOG_READER_RELEASE_POINTER_CHANGED')
        verify_files(item['previous'], item['oldHashes'])
        verify_files(item['next'], item['newHashes'])
    for item in report['roles'].values():
        move_link(item['current'], item['previous'] if restore else item['next'])


if __name__ == '__main__':
    try:
        if os.geteuid() != 0:
            raise ValueError('ROOT_REQUIRED')
        if len(sys.argv) == 5 and sys.argv[1] == 'prepare':
            prepare(Path(__file__).resolve().parent.parent, sys.argv[2], sys.argv[3], sys.argv[4])
        elif len(sys.argv) == 3 and sys.argv[1] in ('activate', 'restore'):
            switch(sys.argv[2], restore=sys.argv[1] == 'restore')
        else:
            raise ValueError('USAGE_STAGE_LOG_READERS_PREPARE_OR_ACTIVATE_OR_RESTORE')
    except Exception as error:
        message = str(error)
        print(message if re.fullmatch(r'[A-Z][A-Z0-9_]{2,100}', message) else 'LOG_READER_RELEASE_UPDATE_FAILED', file=sys.stderr)
        sys.exit(1)

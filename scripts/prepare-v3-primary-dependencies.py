#!/usr/bin/env python3
"""Reuse only the successful hourly release's matching build dependencies."""
import argparse
import os
from pathlib import Path
import stat
import subprocess
import sys

SOURCE_SHA = 'b53e4d25f7f89a84a1244cdbba28f10c2014c9e8'
LOCKS = ('package.json', 'package-lock.json', 'website/package.json', 'website/package-lock.json')
DEP_DIRS = ('node_modules', 'website/node_modules')


def checked(path, kind, owner):
    item = path.lstat()
    if stat.S_ISLNK(item.st_mode) or item.st_uid != owner or item.st_mode & 0o022:
        raise ValueError('UNSAFE_BUILD_DEPENDENCIES')
    if kind == 'dir' and not stat.S_ISDIR(item.st_mode):
        raise ValueError('UNSAFE_BUILD_DEPENDENCIES')
    if kind == 'file' and not stat.S_ISREG(item.st_mode):
        raise ValueError('UNSAFE_BUILD_DEPENDENCIES')


def source_in_use(source):
    # A previous build could be running npm ci in this checkout.
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            cwd = (entry / 'cwd').resolve(strict=True)
            if cwd == source or source in cwd.parents:
                return True
        except (OSError, RuntimeError):
            continue
    return False


def validate_source(target, source, owner=None, check_process=True, source_root=Path('/opt')):
    owner = os.geteuid() if owner is None else owner
    checked(source, 'dir', owner)
    source = source.resolve(strict=True)
    if source.parent != source_root.resolve(strict=True) or not source.name.startswith('global-v3-team.'):
        raise ValueError('UNEXPECTED_DEPENDENCY_SOURCE')
    checked(source / '.git', 'dir', owner)
    checked(source / 'website', 'dir', owner)
    checked(target / 'website', 'dir', owner)
    head = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    if head != SOURCE_SHA or subprocess.run(['git', '-C', str(source), 'diff', '--quiet', 'HEAD', '--']).returncode:
        raise ValueError('DEPENDENCY_SOURCE_RELEASE_MISMATCH')
    for rel in LOCKS:
        checked(source / rel, 'file', owner)
        if (target / rel).read_bytes() != (source / rel).read_bytes():
            raise ValueError('DEPENDENCY_LOCK_MISMATCH')
    for rel in DEP_DIRS:
        checked(source / rel, 'dir', owner)
        checked(source / rel / '.package-lock.json', 'file', owner)
    if check_process and source_in_use(source):
        raise ValueError('DEPENDENCY_SOURCE_IN_USE')
    return source


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['prepare', 'validate'])
    parser.add_argument('--target', type=Path, required=True)
    args = parser.parse_args()
    target = args.target.resolve(strict=True)
    try:
        checked(target, 'dir', os.geteuid())
        if args.mode == 'prepare':
            if any(os.path.lexists(target / rel) for rel in DEP_DIRS):
                raise ValueError('DEPENDENCY_TARGET_ALREADY_EXISTS')
            source = None
            for candidate in sorted(Path('/opt').glob('global-v3-team.*')):
                try:
                    source = validate_source(target, candidate)
                    break
                except (OSError, ValueError, subprocess.SubprocessError):
                    continue
            if source is None:
                raise ValueError('MATCHING_HOURLY_BUILD_DEPENDENCIES_NOT_FOUND')
            os.symlink(source / DEP_DIRS[0], target / DEP_DIRS[0], target_is_directory=True)
            try:
                os.symlink(source / DEP_DIRS[1], target / DEP_DIRS[1], target_is_directory=True)
            except OSError:
                (target / DEP_DIRS[0]).unlink()
                raise
        else:
            root_link, web_link = (target / rel for rel in DEP_DIRS)
            if not root_link.is_symlink() or not web_link.is_symlink():
                raise ValueError('DEPENDENCY_LINKS_REQUIRED')
            source = validate_source(target, root_link.resolve(strict=True).parent)
            if root_link.resolve(strict=True) != source / DEP_DIRS[0] or web_link.resolve(strict=True) != source / DEP_DIRS[1]:
                raise ValueError('DEPENDENCY_LINK_MISMATCH')
        print('V3_PRIMARY_REUSING_VERIFIED_DEPENDENCIES=' + str(source))
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        print('V3_PRIMARY_DEPENDENCIES_BLOCKED=' + str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())

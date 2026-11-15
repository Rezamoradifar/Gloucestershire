#!/usr/bin/env python3
"""Reject unsafe root or asset paths before changing the static site."""
import argparse
import filecmp
from pathlib import Path
import os
import re
import stat
import sys

SAFE_NAME = re.compile(r'^[A-Za-z0-9._-]+$')
HASHED_ASSET = re.compile(r'^.+-[A-Za-z0-9_-]{8}\.(js|css)$')


def checked(path, kind, owner):
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or info.st_uid != owner or info.st_mode & 0o022:
        raise ValueError('UNSAFE_SITE_PATH')
    if kind == 'dir' and not stat.S_ISDIR(info.st_mode):
        raise ValueError('UNSAFE_SITE_PATH')
    if kind == 'file' and not stat.S_ISREG(info.st_mode):
        raise ValueError('UNSAFE_SITE_PATH')


def validate(root, dist, owner=None):
    owner = os.geteuid() if owner is None else owner
    checked(root, 'dir', owner)
    checked(root / 'assets', 'dir', owner)
    checked(dist, 'dir', owner)
    checked(dist / 'assets', 'dir', owner)
    seen = 0
    for source in dist.rglob('*'):
        rel = source.relative_to(dist)
        if any(not SAFE_NAME.fullmatch(part) for part in rel.parts):
            raise ValueError('UNSAFE_BUILD_PATH')
        if source.is_symlink():
            raise ValueError('UNSAFE_BUILD_PATH')
        if source.is_dir():
            if rel.parts != ('assets',):
                raise ValueError('UNEXPECTED_BUILD_DIRECTORY')
            checked(source, 'dir', owner)
            continue
        checked(source, 'file', owner)
        if len(rel.parts) > 2 or (len(rel.parts) == 2 and rel.parts[0] != 'assets'):
            raise ValueError('UNEXPECTED_BUILD_PATH')
        destination = root / rel
        if os.path.lexists(destination):
            checked(destination, 'file', owner)
            if len(rel.parts) == 2 and HASHED_ASSET.fullmatch(rel.name) and not filecmp.cmp(source, destination, shallow=False):
                raise ValueError('HASHED_ASSET_COLLISION')
        seen += 1
    if not seen or not (dist / 'index.html').is_file():
        raise ValueError('BUILD_EMPTY')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--site-root', type=Path, required=True)
    parser.add_argument('--dist', type=Path, required=True)
    args = parser.parse_args()
    try:
        validate(args.site_root, args.dist)
    except (OSError, ValueError) as exc:
        print('V3_PRIMARY_SITE_PATHS_BLOCKED=' + str(exc), file=sys.stderr)
        return 1
    print('V3_PRIMARY_SITE_PATHS_VERIFIED')
    return 0


if __name__ == '__main__':
    sys.exit(main())

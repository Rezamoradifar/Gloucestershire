#!/usr/bin/env python3
"""Remove only obsolete, flat, hashed Vite JS/CSS from the current site root.

Called after the new index and API have been checked and while the site
installer lock is held. It never scans releases, backups or financial data.
"""
import argparse
import hashlib
import os
from pathlib import Path
import re
import stat

ASSET = re.compile(r'^[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8}\.(?:js|css)$')


def digest(path):
    with path.open('rb') as source:
        result = hashlib.sha256()
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            result.update(chunk)
        return result.digest()


def checked_dir(path, owner):
    if not path.is_absolute() or path.is_symlink():
        raise ValueError('UNSAFE_DIRECTORY')
    info = path.stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != owner or info.st_mode & 0o022:
        raise ValueError('UNSAFE_DIRECTORY')
    return path.resolve(strict=True)


def retired_files(site_root, dist, owner=None):
    owner = os.geteuid() if owner is None else owner
    root = checked_dir(site_root, owner)
    site_assets = checked_dir(root / 'assets', owner)
    build = dist.resolve(strict=True)
    build_assets = build / 'assets'
    if not build.is_dir() or not build_assets.is_dir():
        raise ValueError('BUILD_ASSETS_MISSING')
    if (root / 'index.html').is_symlink() or (root / 'index.html').read_bytes() != (build / 'index.html').read_bytes():
        raise ValueError('CURRENT_INDEX_MISMATCH')
    current = [p for p in build_assets.iterdir() if ASSET.fullmatch(p.name)]
    if not current or not any(p.suffix == '.js' for p in current):
        raise ValueError('CURRENT_ASSET_MANIFEST_EMPTY')
    for item in current:
        deployed = site_assets / item.name
        if not item.is_file() or item.is_symlink() or not deployed.is_file() or deployed.is_symlink() or digest(item) != digest(deployed):
            raise ValueError('CURRENT_ASSET_MISMATCH')
    keep = {item.name for item in current}
    # Do not follow directories or symbolic links. Other files may belong to
    # the web server or a different service and are deliberately excluded.
    return sorted(p for p in site_assets.iterdir()
                  if ASSET.fullmatch(p.name) and p.name not in keep
                  and p.is_file() and not p.is_symlink())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--site-root', type=Path, required=True)
    parser.add_argument('--dist', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        paths = retired_files(args.site_root, args.dist)
        if args.apply:
            for path in paths:
                path.unlink()
        print('V3_RETIRED_HASHED_ASSETS_' + ('REMOVED=' if args.apply else 'FOUND=') + str(len(paths)))
    except (OSError, ValueError) as exc:
        print('V3_RETIRED_ASSET_CLEANUP_STOPPED=' + str(exc))
        raise SystemExit(1)


if __name__ == '__main__':
    main()

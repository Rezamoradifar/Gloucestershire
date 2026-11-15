#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import tempfile

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('paths', HERE / 'check-v3-publish-paths.py')
paths = importlib.util.module_from_spec(spec)
spec.loader.exec_module(paths)

with tempfile.TemporaryDirectory() as temp:
    temp = Path(temp)
    root, dist, external = temp / 'site', temp / 'dist', temp / 'external'
    for item in (root / 'assets', dist / 'assets', external):
        item.mkdir(parents=True)
    (dist / 'index.html').write_text('new')
    (dist / 'assets/index-1234abcd.js').write_text('new js')
    (root / 'index.html').write_text('old')
    paths.validate(root, dist)
    (root / 'assets/index-1234abcd.js').write_text('different')
    try:
        paths.validate(root, dist)
        raise AssertionError('a hashed filename collision was accepted')
    except ValueError:
        pass
    (root / 'assets/index-1234abcd.js').unlink()
    (root / 'assets/index-1234abcd.js').symlink_to(external / 'file')
    try:
        paths.validate(root, dist)
        raise AssertionError('a target symlink was accepted')
    except ValueError:
        pass
print('PASS deployment target validation and collision/symlink guards')

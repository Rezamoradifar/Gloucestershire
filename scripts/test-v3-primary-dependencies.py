#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('deps', HERE / 'prepare-v3-primary-dependencies.py')
deps = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deps)

with tempfile.TemporaryDirectory() as temp:
    root = Path(temp).resolve()
    source, target = root / 'global-v3-team.test', root / 'candidate'
    source.mkdir(); target.mkdir()
    for directory in (source, target):
        (directory / 'website').mkdir()
        for name in deps.LOCKS:
            (directory / name).write_text('matching-' + name)
    for name in deps.DEP_DIRS:
        (source / name).mkdir()
        (source / name / '.package-lock.json').write_text('{}')
    subprocess.run(['git', 'init', '-q', str(source)], check=True)
    subprocess.run(['git', '-C', str(source), 'add', *deps.LOCKS], check=True)
    subprocess.run(['git', '-C', str(source), '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
                    'commit', '-qm', 'test'], check=True)
    deps.SOURCE_SHA = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    assert deps.validate_source(target, source, source_root=root, check_process=False) == source
    (target / 'website/package-lock.json').write_text('changed')
    try:
        deps.validate_source(target, source, source_root=root, check_process=False)
        raise AssertionError('different lockfile accepted')
    except ValueError:
        pass
    (target / 'website/package-lock.json').write_text('matching-website/package-lock.json')
    (source / 'node_modules').chmod(0o777)
    try:
        deps.validate_source(target, source, source_root=root, check_process=False)
        raise AssertionError('writable dependency directory accepted')
    except ValueError:
        pass
print('PASS matching, changed and unsafe dependency sources')

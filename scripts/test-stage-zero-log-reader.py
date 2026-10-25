#!/usr/bin/env python3
"""Exercise immutable code preparation and partial-pointer recovery."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile

spec = importlib.util.spec_from_file_location('log_release_stage', Path(__file__).with_name('stage-zero-log-reader.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix='zero-log-reader-stage-test-') as temporary:
    root = Path(temporary)
    source = root/'source'
    old_files = {name: ('known installed source '+name+'\n').encode() for name in module.baseline}
    module.baseline = {name: hashlib.sha256(data).hexdigest() for name, data in old_files.items()}
    for name in [*module.baseline, module.helper]:
        file = source/name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text('updated source '+name+'\n')
    for role in ['api', 'daily']:
        old = root/role/'releases/old'
        for name in ['server', 'scripts']:
            (old/name).mkdir(parents=True)
        for name in module.roles[role]:
            if name in old_files:
                (old/name).write_bytes(old_files[name])
        (old/'unchanged-file').write_text('preserved\n')
        (root/role/'current').symlink_to(old, target_is_directory=True)
    manifest = root/'manifest.json'
    module.prepare(source, root/'api/current', root/'daily/current', manifest)
    report = module.read_manifest(manifest)
    assert all((root/role/'current').resolve()==root/role/'releases/old' for role in ['api','daily'])
    api_next = Path(report['roles']['api']['next'])
    helper = api_next/module.helper
    saved = helper.read_bytes()
    helper.write_text('changed after staging')
    try:
        module.switch(manifest)
        raise AssertionError('Changed staged source accepted')
    except ValueError:
        pass
    assert (root/'api/current').resolve()==root/'api/releases/old'
    helper.write_bytes(saved)
    module.switch(manifest)
    for role in ['api','daily']:
        new = (root/role/'current').resolve()
        assert new==Path(report['roles'][role]['next'])
        assert (new/'unchanged-file').read_text()=='preserved\n'
        assert not (root/role/'releases/old'/module.helper).exists()
    # Recovery accepts one already restored pointer after partial activation.
    (root/'daily/current').unlink()
    (root/'daily/current').symlink_to(root/'daily/releases/old', target_is_directory=True)
    module.switch(manifest, restore=True)
    assert all((root/role/'current').resolve()==root/role/'releases/old' for role in ['api','daily'])
    (root/'api/current').unlink()
    (root/'api/current').symlink_to(source, target_is_directory=True)
    try:
        module.switch(manifest, restore=True)
        raise AssertionError('Unrelated release pointer accepted')
    except ValueError:
        pass
    assert (root/'api/current').resolve()==source
    assert (root/'daily/current').resolve()==root/'daily/releases/old'
print('LOG_READER_RELEASE_STAGE_TESTS_PASSED')

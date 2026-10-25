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
    previous_helper = b'known previous complete log reader\n'
    module.previous_helper_hashes = {hashlib.sha256(previous_helper).hexdigest()}
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
            elif name == module.helper:
                (old/name).write_bytes(previous_helper)
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
        assert (root/role/'releases/old'/module.helper).read_bytes() == previous_helper
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
    (root/'api/current').unlink()
    (root/'api/current').symlink_to(root/'api/releases/old', target_is_directory=True)
    unknown = root/'api/releases/old'/module.helper
    unknown.write_bytes(b'unreviewed installed helper\n')
    try:
        module.prepare(source, root/'api/current', root/'daily/current', root/'rejected.json')
        raise AssertionError('An unreviewed installed helper was accepted')
    except ValueError:
        pass
    assert not (root/'rejected.json').exists()
    assert unknown.read_bytes()==b'unreviewed installed helper\n'
    assert all((root/role/'current').resolve()==root/role/'releases/old' for role in ['api','daily'])
print('LOG_READER_RELEASE_STAGE_TESTS_PASSED')

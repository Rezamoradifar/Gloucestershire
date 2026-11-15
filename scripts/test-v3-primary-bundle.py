#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import tempfile

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('bundle', HERE / 'check-v3-hourly-primary-bundle.py')
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)

address = '0x' + '1' * 40
runtime = '0x' + 'a' * 64
tx = '0x' + 'b' * 64
with tempfile.TemporaryDirectory() as temp:
    dist = Path(temp)
    assets = dist / 'assets'
    assets.mkdir()
    (dist / 'index.html').write_text('<script type="module" crossorigin src="./assets/index-abc12345.js"></script>')
    entry = assets / 'index-abc12345.js'
    dashboard = assets / 'V3Dashboard-def12345.js'
    entry.write_text('"V3Dashboard-def12345.js"; "Follow your one-hour test cycle"')
    dashboard.write_text(f'{address} {runtime} {tx} ONE-HOUR BNB TESTNET CONTRACT. Test tokens only.')
    assert bundle.inspect(dist, address, runtime, tx) == ('assets/index-abc12345.js', 'assets/V3Dashboard-def12345.js')
    for field in (address, runtime, tx):
        original = dashboard.read_text()
        dashboard.write_text(original.replace(field, 'missing'))
        try:
            bundle.inspect(dist, address, runtime, tx)
            raise AssertionError('identity mismatch was accepted')
        except ValueError:
            pass
        dashboard.write_text(original)
    (assets / 'V2Dashboard-old12345.js').write_text('old')
    try:
        bundle.inspect(dist, address, runtime, tx)
        raise AssertionError('retired dashboard was accepted')
    except ValueError:
        pass
print('PASS primary hourly bundle identity, disclosures and retired-dashboard guard')

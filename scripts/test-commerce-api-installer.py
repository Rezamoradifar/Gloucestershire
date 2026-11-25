"""Exercise a narrowly scoped API upgrade and its failure rollback with stub services."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

repo = Path(__file__).resolve().parent.parent
real_git, real_node, real_stat = map(shutil.which, ['git', 'node', 'stat'])
assert real_git and real_node and real_stat
def historical_blob(blob):
    # Use the actual shipped module where the checkout contains its history.
    # Shallow checkouts exercise the same version matrix with the Git stub.
    result = subprocess.run([real_git, 'cat-file', 'blob', blob], cwd=repo, capture_output=True)
    return result.stdout if result.returncode == 0 else f'test-blob:{blob}\n'.encode()

baseline = historical_blob('5cae7c3c414386fecb82a0226b43237c3445001d')
expected = 'a' * 40

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    for name in ['bin', 'scripts', 'server', 'test', 'etc/systemd/system',
                 'etc/globaldroptrade', 'opt/globaldroptrade-api/releases/old/server',
                 'opt/globaldroptrade-api/releases/old/node_modules', 'var/lib/globaldroptrade']:
        (root / name).mkdir(parents=True, exist_ok=True)
    for name in ['scripts/install-commerce-api-only.sh', 'server/trades-api.mjs',
                 'server/commerce-ebay.mjs', 'server/trading-activity.mjs', 'test/commerce-ebay.test.mjs', 'test/trading-activity.test.mjs']:
        source = (repo / name).read_text()
        if name.endswith('.sh'):
            for prefix in ['/opt/', '/etc/', '/var/']:
                source = source.replace(prefix, str(root) + prefix)
        (root / name).write_text(source)
    previous = root / 'opt/globaldroptrade-api/releases/old'
    (previous / 'server/trades-api.mjs').write_bytes(baseline)
    (previous / 'node_modules/sentinel').write_text('preserved dependency')
    (previous / 'unrelated-code').write_text('preserved')
    current = root / 'opt/globaldroptrade-api/current'
    current.symlink_to(previous)
    envfile = root / 'etc/globaldroptrade/trades.env'
    envfile.write_text('TRADES_CHAIN_ID=97\nEBAY_CLIENT_SECRET=never-print-this\n')
    envfile.chmod(0o600)
    unit = root / 'etc/systemd/system/globaldroptrade-api.service'
    unit.write_text('[Service]\nWorkingDirectory='+str(current)+'\nExecStart=/usr/bin/node '+str(current)+'/server/trades-api.mjs\n')
    original_env, original_unit = envfile.read_bytes(), unit.read_bytes()
    stubs = {
        'id': 'if [[ "$1" == -u ]]; then echo 0; else exit 1; fi',
        'stat': f'if [[ "$1" == -c && "$2" == %u ]]; then echo 0; else exec "{real_stat}" "$@"; fi',
        'git': f'''if [[ "$1" == rev-parse ]]; then echo {expected}; exit 0; fi
if [[ "$1" == hash-object ]]; then
 IFS= read -r first < "${{!#}}" || true
 if [[ "$first" =~ ^test-blob:([a-f0-9]{{40}})$ ]]; then echo "${{BASH_REMATCH[1]}}"; exit 0; fi
fi
exec "{real_git}" "$@"''',
        'node': f'if [[ "$1" == --test || ( "$1" == --env-file=* && $# -gt 3 ) ]]; then exit 0; else exec "{real_node}" "$@"; fi',
        'systemctl': f'if [[ "$1" == restart ]]; then echo restart >> "{root}/restarts"; fi; exit 0',
        'curl': f'''target=''
url=''
while [[ $# -gt 0 ]]; do
 if [[ "$1" == -o ]]; then shift; target="$1"; fi
 if [[ "$1" == http://* ]]; then url="$1"; fi
 shift
done
case "$url" in
 */api/health) printf '{{"status":"ok"}}' > "$target" ;;
 */api/config) if [[ -f "{root}/fail" && -f "{root}/restarts" ]]; then printf '{{"vault":"changed"}}' > "$target"; else printf '{{"vault":"original"}}' > "$target"; fi ;;
 */api/marketplace*) printf '{{"providers":[{{}},{{}}]}}' > "$target" ;;
 */api/commerce/activity*)
   source="${{url##*=}}"
   if [[ -f "{root}/wrong-seller" && "$source" == ebay ]]; then source=kraken; fi
   printf '{{"source":"%s","status":"not_configured","rows":[]}}' "$source" > "$target" ;;
 */api/commerce/status) printf '{{"version":1,"source":"ebay","status":"not_configured","commercialProfit":null,"profitStatus":"unverified_costs_and_fees"}}' > "$target" ;;
 *) exit 1 ;;
esac''',
    }
    for name, body in stubs.items():
        file = root / 'bin' / name
        file.write_text('#!/bin/bash\n' + body + '\n')
        file.chmod(0o755)
    env = {**os.environ, 'PATH': str(root / 'bin') + ':' + os.environ['PATH'],
           'GLOBAL_COMMERCE_EXPECTED_SHA': expected}
    def run(mode):
        return subprocess.run(['bash', str(root / 'scripts/install-commerce-api-only.sh'), mode],
                              cwd=root, env=env, text=True, capture_output=True)
    check = run('--check')
    assert check.returncode == 0, check.stderr
    assert current.resolve() == previous and not (root / 'restarts').exists()
    installed = run('--install')
    assert installed.returncode == 0, installed.stdout + installed.stderr
    assert current.resolve() != previous
    assert (current / 'server/commerce-ebay.mjs').is_file()
    assert (current / 'server/trading-activity.mjs').is_file()
    again = run('--install')
    assert again.returncode == 0 and 'COMMERCE_API_ALREADY_INSTALLED' in again.stdout
    assert (root / 'restarts').read_text().count('restart') == 1
    assert (current / 'node_modules/sentinel').read_text() == 'preserved dependency'
    assert (current / 'unrelated-code').read_text() == 'preserved'
    assert envfile.read_bytes() == original_env and unit.read_bytes() == original_unit
    assert 'never-print-this' not in installed.stdout + installed.stderr
    modules = [previous / 'server' / name for name in ('trades-api.mjs', 'commerce-ebay.mjs', 'trading-activity.mjs')]
    summary_api = '3455a60264a754cc6a558737ded964391d517109'
    for hashes in [
            (summary_api, '967e427df79f212b956e11724c331ac26326e426', None),
            (summary_api, '317ae1adc05081ee2e0ee3f6cc36e8d6535918ec', None),
            ('c94269f994a19dbb641f30430441df776d78e065', '6f21e279898a3326790a7a856e3a2b9d7c2bd040', 'cbe54780136ea3fc4afc21c3ee6bfca7588474ee'),
            ('c94269f994a19dbb641f30430441df776d78e065', '780c0035f2727a4325c2ae56efba2acd4df896e6', 'beaa81c538b393513ac1e96a7e490709130b9ac3'),
            ('e786a10d90a6918f95187ff1cdf982b0e4490a40', 'd8ebad0e2f064bd4c7ac0ad177da17b32b51e124', 'cbe54780136ea3fc4afc21c3ee6bfca7588474ee')]:
        current.unlink()
        current.symlink_to(previous)
        for file, blob in zip(modules, hashes):
            if blob:
                file.write_bytes(historical_blob(blob))
            else:
                file.unlink(missing_ok=True)
        upgrade = run('--install')
        assert upgrade.returncode == 0 and current.resolve() != previous, upgrade.stdout + upgrade.stderr
        for file, blob in zip(modules, hashes):
            if blob is None:
                assert not file.exists()
            else:
                assert file.read_bytes() == historical_blob(blob)
    modules[0].write_bytes(baseline)
    for file in modules[1:]:
        file.unlink(missing_ok=True)
    current.unlink()
    current.symlink_to(previous)
    (root / 'restarts').unlink()
    (root / 'fail').touch()
    failed = run('--install')
    assert failed.returncode != 0 and current.resolve() == previous
    assert 'COMMERCE_PREVIOUS_API_RESTORED' in failed.stdout
    assert envfile.read_bytes() == original_env and unit.read_bytes() == original_unit
    assert (root / 'restarts').read_text().count('restart') == 2
    (root / 'fail').unlink()
    (root / 'wrong-seller').touch()
    wrong_source = run('--install')
    assert wrong_source.returncode != 0 and current.resolve() == previous
    assert 'TRADING_ACTIVITY_RESPONSE_INVALID' in wrong_source.stderr
    assert 'COMMERCE_PREVIOUS_API_RESTORED' in wrong_source.stdout
    (root / 'wrong-seller').unlink()
    (previous / 'server/trades-api.mjs').write_text('unreviewed')
    (root / 'restarts').unlink()
    refused = run('--install')
    assert refused.returncode != 0 and 'COMMERCE_LIVE_API_VERSION_REVIEW_REQUIRED' in refused.stdout
    assert 'COMMERCE_MODULE_FINGERPRINT=' in refused.stdout and '/missing/missing' in refused.stdout
    assert not (root / 'restarts').exists() and current.resolve() == previous
    modules[0].write_bytes(historical_blob(summary_api))
    modules[1].symlink_to(envfile)
    invalid_module = run('--install')
    assert invalid_module.returncode != 0 and '/symlink/missing' in invalid_module.stdout
    assert 'never-print-this' not in invalid_module.stdout + invalid_module.stderr
    assert not (root / 'restarts').exists() and current.resolve() == previous
    modules[1].unlink()
    (previous / 'server/trades-api.mjs').write_bytes(baseline)
    (previous / 'server').chmod(0o777)
    unsafe = run('--install')
    assert unsafe.returncode != 0 and 'COMMERCE_API_PERMISSIONS_UNSAFE' in unsafe.stdout
    assert not (root / 'restarts').exists() and current.resolve() == previous
    (previous / 'server').chmod(0o755)
    envfile.write_text('TRADES_CHAIN_ID=97\nCOMMUNITY_DATA_FILE=relative/community.json\n')
    relative = run('--install')
    assert relative.returncode != 0 and 'COMMERCE_RELATIVE_DATA_PATH_REVIEW_REQUIRED' in relative.stderr
    assert not (root / 'restarts').exists() and current.resolve() == previous
    envfile.write_text('COMMERCE_PRODUCT_CATALOG_FILE=relative/model-catalog.json\n')
    product_path = run('--install')
    assert product_path.returncode != 0 and 'COMMERCE_RELATIVE_DATA_PATH_REVIEW_REQUIRED=COMMERCE_PRODUCT_CATALOG_FILE' in product_path.stderr
    assert not (root / 'restarts').exists() and current.resolve() == previous
    print('PASS: historical commerce upgrades, idempotence, rollback, configuration preservation and unknown-module diagnostics')

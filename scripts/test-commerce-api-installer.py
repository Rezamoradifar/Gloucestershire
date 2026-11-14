"""Exercise a narrowly scoped API upgrade and its failure rollback with stub services."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

repo = Path(__file__).resolve().parent.parent
real_git, real_node, real_stat = map(shutil.which, ['git', 'node', 'stat'])
assert real_git and real_node and real_stat
baseline = b'known-reviewed-api-fixture\n'
expected = 'a' * 40

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    for name in ['bin', 'scripts', 'server', 'test', 'etc/systemd/system',
                 'etc/globaldroptrade', 'opt/globaldroptrade-api/releases/old/server',
                 'opt/globaldroptrade-api/releases/old/node_modules', 'var/lib/globaldroptrade']:
        (root / name).mkdir(parents=True, exist_ok=True)
    for name in ['scripts/install-commerce-api-only.sh', 'server/trades-api.mjs',
                 'server/commerce-ebay.mjs', 'test/commerce-ebay.test.mjs']:
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
        'git': f'''if [[ "$1" == rev-parse ]]; then echo {expected}
elif [[ "$1" == hash-object && "$(cat "$2")" == known-reviewed-api-fixture ]]; then echo 5cae7c3c414386fecb82a0226b43237c3445001d
else exec "{real_git}" "$@"; fi''',
        'node': f'if [[ "$1" == --test || "$1" == --env-file=* ]]; then exit 0; else exec "{real_node}" "$@"; fi',
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
    assert (current / 'node_modules/sentinel').read_text() == 'preserved dependency'
    assert (current / 'unrelated-code').read_text() == 'preserved'
    assert envfile.read_bytes() == original_env and unit.read_bytes() == original_unit
    assert 'never-print-this' not in installed.stdout + installed.stderr
    current.unlink()
    current.symlink_to(previous)
    (root / 'restarts').unlink()
    (root / 'fail').touch()
    failed = run('--install')
    assert failed.returncode != 0 and current.resolve() == previous
    assert 'COMMERCE_PREVIOUS_API_RESTORED' in failed.stdout
    assert envfile.read_bytes() == original_env and unit.read_bytes() == original_unit
    assert (root / 'restarts').read_text().count('restart') == 2
    (previous / 'server/trades-api.mjs').write_text('unreviewed')
    (root / 'restarts').unlink()
    refused = run('--install')
    assert refused.returncode != 0 and 'COMMERCE_LIVE_API_VERSION_REVIEW_REQUIRED' in refused.stdout
    assert not (root / 'restarts').exists() and current.resolve() == previous
    (previous / 'server/trades-api.mjs').write_bytes(baseline)
    (previous / 'server').chmod(0o777)
    unsafe = run('--install')
    assert unsafe.returncode != 0 and 'COMMERCE_API_PERMISSIONS_UNSAFE' in unsafe.stdout
    assert not (root / 'restarts').exists() and current.resolve() == previous
    print('PASS: read-only preflight, staged API, configuration preservation, rollback and unknown-release refusal')

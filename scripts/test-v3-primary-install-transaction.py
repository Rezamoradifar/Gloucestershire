#!/usr/bin/env python3
"""Exercise the root installer, including post-switch failure and rollback."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent.parent
ADDR = '0x4F2777861cc5bDD0d6AED86014cE1370BF823884'
RUNTIME = '0x' + 'a' * 64
TX = '0x' + 'b' * 64
SHA = '1' * 40


def exercise(fail_asset=False, mode='--install', single_capital=False, bad_proof=False):
    with tempfile.TemporaryDirectory(prefix='v3-primary-test-') as temp:
        tmp = Path(temp)
        repo, tools, site = tmp / 'repo', tmp / 'bin', tmp / 'site'
        (repo / 'scripts').mkdir(parents=True)
        (repo / 'website/dist/assets').mkdir(parents=True)
        (site / 'assets').mkdir(parents=True)
        (site / 'hourly-test').mkdir()
        (tmp / 'state/v3-hourly-testnet').mkdir(parents=True)
        tools.mkdir()
        (site / 'index.html').write_text('OLD MAIN SITE\n')
        (site / 'hourly-test/index.html').write_text('HOURLY SITE\n')
        (site / 'assets/index-old12345.js').write_text('old main script')
        html = '<script type="module" crossorigin src="./assets/index-new12345.js"></script>'
        (repo / 'website/dist/index.html').write_text(html)
        (repo / 'website/dist/assets/index-new12345.js').write_text('V3Dashboard-new12345.js Follow your one-hour test cycle')
        address = '0x' + '3' * 40 if single_capital else ADDR
        (repo / 'website/dist/assets/V3Dashboard-new12345.js').write_text(
            f'{address} {RUNTIME} {TX} 0xA98D8d3709f5D3730BAD5d76C334731784e7CF07 '
            'ONE-HOUR BNB TESTNET CONTRACT. Test tokens only. single-capital-testnet')
        shutil.copy(HERE / 'scripts/check-v3-hourly-primary-bundle.py', repo / 'scripts')
        shutil.copy(HERE / 'scripts/check-v3-publish-paths.py', repo / 'scripts')
        shutil.copy(HERE / 'scripts/check-v3-unified-route.py', repo / 'scripts')
        source = (HERE / 'ubuntu-global-v2-site.sh').read_text()
        source = source.replace('/opt/global-v2-site-stage.', str(tmp / 'stage.'))
        source = source.replace('/var/lib/globaldroptrade/', str(tmp / 'state') + '/')
        source = source.replace('/var/backups/globaldroptrade/', str(tmp / 'backup') + '/')
        (repo / 'ubuntu-global-v2-site.sh').write_text(source)
        stubs = {
            'id': '#!/bin/bash\nif [[ $1 == -u ]]; then echo 0; else /usr/bin/id "$@"; fi\n',
            'stat': '#!/bin/bash\nif [[ $1 == -c && $2 == %u ]]; then echo 0; else /usr/bin/stat "$@"; fi\n',
            'git': '#!/bin/bash\nprintf "%s\\n" "$TEST_SHA"\n',
            'nginx': '#!/bin/bash\nexit 0\n',
            'npm': '#!/bin/bash\nexit 0\n',
            'python3': '''#!/bin/bash
case "$1" in
 scripts/prepare-v3-primary-dependencies.py) exit 0 ;;
 scripts/verify-nginx-served-root.py) printf '%s\\n' "$TEST_SITE" ;;
 *) exec /usr/bin/python3 "$@" ;;
esac
''',
            'node': '''#!/bin/bash
if [[ "$1" == scripts/publish-v3-single-capital-primary.mjs ]]; then
 [[ "$2" == --check-build && "${TEST_BAD_PRIMARY_PROOF:-}" != 1 ]] || exit 7
 exit 0
fi
if [[ "$1" == scripts/verify-v3-hourly-testnet.mjs ]]; then
 [[ "${GLOBAL_V3_MAIN_PREPARED_BUILD:-}" != single-capital-testnet ]] || exit 8
 echo "export VITE_V3_CONTRACT_ADDRESS=$VITE_V3_CONTRACT_ADDRESS"
 echo "export VITE_V3_RUNTIME_HASH=$VITE_V3_RUNTIME_HASH"
 echo "export VITE_V3_DEPLOYMENT_TX=$VITE_V3_DEPLOYMENT_TX"
fi
if [[ "$1" == scripts/read-v3-wallet-config.mjs ]]; then echo 0123456789abcdef0123456789abcdef; fi
exit 0
''',
            'curl': '''#!/bin/bash
dest=''; url=''; mime=0
while [[ $# -gt 0 ]]; do
 case "$1" in
  -o) dest="$2"; shift 2 ;;
  -w) mime=1; shift 2 ;;
  --noproxy|--max-time|--resolve) shift 2 ;;
  https://*) url="$1"; shift ;;
  *) shift ;;
 esac
done
case "$url" in
 */api/config) printf 'unchanged API\\n' > "$dest" ;;
 */hourly-test/) cp "$TEST_SITE/hourly-test/index.html" "$dest" ;;
 */assets/*)
   if [[ "${TEST_FAIL_ASSET:-}" == 1 ]]; then echo CORRUPTED > "$dest"; else cp "$TEST_SITE/${url#*com/}" "$dest"; fi ;;
 *) cp "$TEST_SITE/index.html" "$dest" ;;
esac
if [[ "$mime" == 1 ]]; then printf text/javascript; fi
'''
        }
        for name, text in stubs.items():
            file = tools / name
            file.write_text(text)
            file.chmod(0o755)
        env = {**os.environ, 'PATH': str(tools) + ':' + os.environ['PATH'],
               'TEST_SITE': str(site), 'TEST_SHA': SHA, 'GLOBAL_V2_EXPECTED_SHA': SHA,
               'GLOBAL_V3_MAIN_REUSE_TESTED_DEPS': '1', 'VITE_V3_HOURLY_TEST': 'isolated-1h',
               'VITE_V3_PRIMARY_DASHBOARD': 'verified-testnet', 'VITE_V3_LANDING_AT_ROOT': 'true',
               'V3_EXPECTED_WALLET_CONFIG': '0123456789abcdef0123456789abcdef',
               'VITE_V3_CONTRACT_ADDRESS': address, 'VITE_V3_RUNTIME_HASH': RUNTIME,
               'VITE_V3_DEPLOYMENT_TX': TX, 'TEST_FAIL_ASSET': '1' if fail_asset else '0',
               'TEST_BAD_PRIMARY_PROOF': '1' if bad_proof else '0'}
        if single_capital:
            env.update(GLOBAL_V3_MAIN_PREPARED_BUILD='single-capital-testnet',
                       VITE_V3_UNIFIED_MODE='single-capital-testnet',
                       VITE_V3_UNIFIED_PRIMARY='single-capital-testnet',
                       GLOBAL_V3_PRIMARY_PROOF_SHA256='c' * 64,
                       GLOBAL_V3_PRIMARY_RPC='https://bsc-testnet-rpc.publicnode.com')
        result = subprocess.run(['/bin/bash', str(repo / 'ubuntu-global-v2-site.sh'), mode],
                                cwd=repo, env=env, text=True, capture_output=True)
        if bad_proof:
            assert result.returncode != 0
            assert (site / 'index.html').read_text() == 'OLD MAIN SITE\n'
            assert not (site / 'assets/index-new12345.js').exists()
        elif mode == '--check':
            assert result.returncode == 0, result.stdout + result.stderr
            assert 'V2_SITE_PREFLIGHT_PASS' in result.stdout
            assert (site / 'index.html').read_text() == 'OLD MAIN SITE\n'
            assert not (site / 'assets/index-new12345.js').exists()
        elif fail_asset:
            assert result.returncode != 0, result.stdout + result.stderr
            assert 'V2_SITE_ROLLBACK_OK' in result.stdout
            assert (site / 'index.html').read_text() == 'OLD MAIN SITE\n'
            assert not (site / 'assets/index-new12345.js').exists()
        else:
            assert result.returncode == 0, result.stdout + result.stderr
            assert (site / 'index.html').read_text() == html
            assert (site / 'assets/index-new12345.js').is_file()
            assert 'V2_SITE_ONLY_INSTALLED' in result.stdout
        assert (site / 'hourly-test/index.html').read_text() == 'HOURLY SITE\n'
        assert (site / 'assets/index-old12345.js').read_text() == 'old main script'


exercise(mode='--check')
exercise(fail_asset=True)
exercise()
exercise(mode='--check', single_capital=True)
exercise(fail_asset=True, single_capital=True)
exercise(single_capital=True, bad_proof=True)
exercise(single_capital=True)
print('PASS main-site preflight, asset failure rollback and hourly-test preservation')

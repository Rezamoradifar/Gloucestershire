#!/usr/bin/env python3
"""Ensure the wrapper fails closed and passes only the verified hourly identity."""
import os
from pathlib import Path
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent.parent
SHA = '1' * 40
ADDR = '0x4F2777861cc5bDD0d6AED86014cE1370BF823884'
RUNTIME = '0x' + 'a' * 64
TX = '0x' + 'b' * 64

with tempfile.TemporaryDirectory(prefix='v3-primary-wrapper-') as temp:
    tmp = Path(temp)
    repo, tools, site = tmp / 'repo', tmp / 'bin', tmp / 'site'
    (repo / '.git').mkdir(parents=True)
    (repo / 'scripts').mkdir()
    (site / 'hourly-test/assets').mkdir(parents=True)
    (site / 'hourly-test/index.html').write_text('hourly')
    (site / 'index.html').write_text('main')
    tools.mkdir()
    (repo / 'scripts/install-v3-hourly-primary-site.sh').write_text(
        (HERE / 'scripts/install-v3-hourly-primary-site.sh').read_text())
    stubs = {
        'id': '#!/bin/bash\necho 0\n',
        'stat': '#!/bin/bash\nif [[ $1 == -c && $2 == %u ]]; then echo 0; else /usr/bin/stat "$@"; fi\n',
        'hostname': '#!/bin/bash\necho "${TEST_HOST:-vps-luna-2585}"\n',
        'git': '#!/bin/bash\nif [[ $1 == rev-parse ]]; then echo "$TEST_SHA"; else exit 0; fi\n',
        'nginx': '#!/bin/bash\nexit 0\n',
        'npm': '#!/bin/bash\nexit 0\n',
        'python3': '''#!/bin/bash
if [[ "$1" == scripts/verify-nginx-served-root.py ]]; then echo "$TEST_SITE"; fi
exit 0
''',
        'node': '''#!/bin/bash
if [[ "$1" == scripts/verify-v3-hourly-testnet.mjs && "$2" == --check ]]; then
 [[ "${TEST_BAD_PROOF:-}" != 1 ]] || exit 1
 exit 0
fi
if [[ "$1" == scripts/verify-v3-hourly-testnet.mjs && "$2" == --emit-site-env ]]; then
 echo "export VITE_V3_CONTRACT_ADDRESS=${TEST_CONTRACT}"
 echo "export VITE_V3_RUNTIME_HASH=${TEST_RUNTIME}"
 echo "export VITE_V3_DEPLOYMENT_TX=${TEST_TX}"
 echo 'export VITE_V3_PRIMARY_DASHBOARD=verified-testnet'
 echo 'export VITE_V3_HOURLY_TEST=isolated-1h'
 exit 0
fi
if [[ "$1" == scripts/read-v3-wallet-config.mjs ]]; then echo 0123456789abcdef0123456789abcdef; exit 0; fi
exit 1
''',
        'curl': '''#!/bin/bash
dest=''; url=''
while [[ $# -gt 0 ]]; do
 case "$1" in
  -o) dest="$2"; shift 2 ;;
  --noproxy|--max-time|--resolve) shift 2 ;;
  https://*) url="$1"; shift ;;
  *) shift ;;
 esac
done
if [[ "$url" == */hourly-test/ ]]; then cp "$TEST_SITE/hourly-test/index.html" "$dest"; else cp "$TEST_SITE/index.html" "$dest"; fi
''',
        'bash': '''#!/bin/bash
[[ "$1" == ubuntu-global-v2-site.sh ]] || exit 1
[[ "$VITE_V3_CONTRACT_ADDRESS" == "$TEST_CONTRACT" && "$VITE_V3_LANDING_AT_ROOT" == true &&
   "$VITE_WALLETCONNECT_PROJECT_ID" == 0123456789abcdef0123456789abcdef &&
   "$GLOBAL_V3_MAIN_REUSE_TESTED_DEPS" == 1 ]] || exit 2
[[ "${TEST_INSTALL_FAIL:-}" != 1 ]] || exit 3
echo MOCK_INSTALLER_PASS
'''
    }
    for name, text in stubs.items():
        path = tools / name
        path.write_text(text); path.chmod(0o755)
    base = {**os.environ, 'PATH': str(tools) + ':' + os.environ['PATH'],
            'TEST_SITE': str(site), 'TEST_SHA': SHA, 'GLOBAL_V2_EXPECTED_SHA': SHA,
            'TEST_CONTRACT': ADDR, 'TEST_RUNTIME': RUNTIME, 'TEST_TX': TX}

    def run(mode, **extra):
        return subprocess.run(['/bin/bash', str(repo / 'scripts/install-v3-hourly-primary-site.sh'), mode],
                              cwd=repo, env={**base, **extra}, text=True, capture_output=True)

    wrong_host = run('--install', TEST_HOST='vps-titan-5756')
    assert wrong_host.returncode and 'V3_PRIMARY_WRONG_SERVER' in wrong_host.stdout
    bad_proof = run('--install', TEST_BAD_PROOF='1')
    assert bad_proof.returncode and 'MOCK_INSTALLER_PASS' not in bad_proof.stdout
    wrong_contract = run('--install', TEST_CONTRACT='0x' + '2' * 40)
    assert wrong_contract.returncode and 'V3_PRIMARY_CONTRACT_NOT_VERIFIED' in wrong_contract.stdout
    failure = run('--install', TEST_INSTALL_FAIL='1')
    assert failure.returncode and 'V3_HOURLY_PRIMARY_SITE_INSTALLED=' not in failure.stdout
    check = run('--check')
    assert check.returncode == 0 and 'V3_HOURLY_PRIMARY_PREFLIGHT_PASS' in check.stdout, check.stdout + check.stderr
    assert 'V3_HOURLY_PRIMARY_SITE_INSTALLED=' not in check.stdout
    install = run('--install')
    assert install.returncode == 0 and 'V3_HOURLY_PRIMARY_SITE_INSTALLED=' in install.stdout, install.stdout + install.stderr
print('PASS primary wrapper host, proof, contract, preflight and failure guards')

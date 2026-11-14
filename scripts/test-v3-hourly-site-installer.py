#!/usr/bin/env python3
"""Exercise separate-site publish, collision and rollback using fake tools."""
import os
from pathlib import Path
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent.parent

with tempfile.TemporaryDirectory(prefix='v3-hourly-install-test-') as scratch:
    root = Path(scratch)
    repo, bin_dir, served = root / 'repo', root / 'bin', root / 'served'
    (repo / 'scripts').mkdir(parents=True)
    (repo / '.git').mkdir()
    (repo / 'website/dist/assets').mkdir(parents=True)
    served.mkdir()
    bin_dir.mkdir()
    (served / 'index.html').write_text('EXISTING MAIN SITE\n')
    (repo / 'website/dist/index.html').write_text('SEPARATE HOURLY TEST SITE\n')
    (repo / 'website/dist/assets/site.js').write_text('SEPARATE ONE-HOUR TEST CONTRACT\n')
    source = (HERE / 'scripts/install-v3-hourly-testnet-site.sh').read_text()
    source = source.replace('/var/lib/globaldroptrade/', str(root / 'var/lib/globaldroptrade') + '/')
    (repo / 'scripts/install-v3-hourly-testnet-site.sh').write_text(source)

    stubs = {
        'id': '''#!/bin/bash
if [[ "$1" == -u ]]; then echo 0; else /usr/bin/id "$@"; fi
''',
        'stat': '''#!/bin/bash
if [[ "$1" == -c && "$2" == %u ]]; then echo 0; else /usr/bin/stat "$@"; fi
''',
        'git': '#!/bin/bash\nprintf "%040d\\n" 1\n',
        'nginx': '#!/bin/bash\nexit 0\n',
        'npm': '#!/bin/bash\nexit 0\n',
        'python3': '#!/bin/bash\nprintf "%s\\n" "$TEST_SERVED_ROOT"\n',
        'node': '''#!/bin/bash
if [[ "${TEST_VERIFY_FAIL:-}" == 1 ]]; then exit 1; fi
if [[ "$2" == --emit-site-env ]]; then
  echo 'export VITE_V3_HOURLY_TEST=isolated-1h'
fi
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
if [[ "$url" == https://globaldroptrade.com/hourly-test/ ]]; then
 [[ "${TEST_BAD_HOURLY:-}" != 1 ]] || exit 22
 cp "$TEST_SERVED_ROOT/hourly-test/index.html" "$dest"
else
 cp "$TEST_SERVED_ROOT/index.html" "$dest"
fi
'''
    }
    for name, contents in stubs.items():
        target = bin_dir / name
        target.write_text(contents)
        target.chmod(0o755)
    env = {**os.environ, 'PATH': str(bin_dir) + ':' + os.environ['PATH'],
           'TEST_SERVED_ROOT': str(served)}

    def run(mode, **extra):
        return subprocess.run(['bash', str(repo / 'scripts/install-v3-hourly-testnet-site.sh'), mode],
                              text=True, capture_output=True, env={**env, **extra})

    check = run('--check')
    assert check.returncode == 0, check.stdout + check.stderr
    assert 'V3_HOURLY_SITE_PREFLIGHT_PASS' in check.stdout
    assert not (served / 'hourly-test').exists()

    fail = run('--install', TEST_BAD_HOURLY='1')
    assert fail.returncode != 0, fail.stdout + fail.stderr
    assert not (served / 'hourly-test').exists()
    assert (served / 'index.html').read_text() == 'EXISTING MAIN SITE\n'

    ok = run('--install')
    assert ok.returncode == 0, ok.stdout + ok.stderr
    assert 'V3_HOURLY_TESTNET_SITE_INSTALLED=' in ok.stdout
    assert (served / 'hourly-test/index.html').read_text() == 'SEPARATE HOURLY TEST SITE\n'
    assert (served / 'index.html').read_text() == 'EXISTING MAIN SITE\n'

    collision = run('--install')
    assert collision.returncode != 0 and 'TARGET_ALREADY_EXISTS' in collision.stdout
    assert (served / 'hourly-test/index.html').read_text() == 'SEPARATE HOURLY TEST SITE\n'
    print('PASS isolated hourly site preflight, publish, collision and rollback')

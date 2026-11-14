#!/usr/bin/env python3
"""Exercise setup with disposable state, mocked systemd and no network."""
import errno
import os
from pathlib import Path
import pty
import re
import subprocess
import tempfile

repo = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='v3-hourly-setup-test-') as temp:
    root = Path(temp)
    for directory in ['bin', 'scripts', '.git', 'var/lib/globaldroptrade/v3-hourly-testnet']:
        (root / directory).mkdir(parents=True, exist_ok=True)
    source = (repo / 'scripts/setup-v3-hourly-testnet.sh').read_text()
    source = re.sub(r'/(?:opt|var)/', lambda m: str(root) + m.group(0), source)
    script = root / 'scripts/setup-v3-hourly-testnet.sh'
    script.write_text(source)
    stubs = {
        'id': 'echo 0',
        'git': "printf '%040d\\n' 1",
        'npm': f'echo "npm $*" >> "{root}/calls"',
        'node': f'''echo "node $*" >> "{root}/calls"
if [[ "$2" == --check-old-testnet-deployer && "$SIM_MODE" == missing_gas ]]; then exit 2; fi
if [[ "$2" == --check && "$SIM_MODE" == bad_proof ]]; then exit 1; fi
if [[ "$2" == --deploy-old-testnet-deployer ]]; then
 echo '{{}}' > "{root}/var/lib/globaldroptrade/v3-hourly-testnet/deployment.json"
fi
exit 0''',
        'systemctl': '''if [[ "$1" == is-enabled ]]; then [[ "$SIM_MODE" == enabled ]]; exit $?; fi
if [[ "$1" == show ]]; then echo inactive; exit 0; fi
if [[ "$1" == is-active ]]; then echo active; exit 0; fi
exit 0''',
        'journalctl': '''if [[ "$SIM_MODE" == installed || "$SIM_MODE" == keeper_blocked || "$SIM_MODE" == ready || "$SIM_MODE" == enabled ]]; then
 echo 'V3_HOURLY_TESTNET_SITE_INSTALLED=https://globaldroptrade.com/hourly-test/'
fi
exit 0''',
        'systemd-run': f'echo "systemd-run $*" >> "{root}/calls"; exit 0'
    }
    for name, content in stubs.items():
        file = root / 'bin' / name
        file.write_text('#!/bin/bash\n' + content + '\n')
        file.chmod(0o755)
    (root / 'scripts/install-global-v3-keeper-timer.sh').write_text(f'''#!/bin/bash
[[ "$GLOBAL_V3_RELEASE_PROFILE" == hourly-testnet ]] || exit 3
echo "keeper $*" >> "{root}/calls"
if [[ "$1" == --check && "$SIM_MODE" == keeper_blocked ]]; then exit 4; fi
exit 0
''')
    env = {**os.environ, 'PATH': str(root / 'bin') + ':' + os.environ['PATH']}

    def run(arg, mode, interactive=False):
        (root / 'calls').unlink(missing_ok=True)
        if interactive:
            master, slave = pty.openpty()
            process = subprocess.Popen(['bash', str(script), arg], cwd=root,
                                       env={**env, 'SIM_MODE': mode},
                                       stdin=slave, stdout=slave, stderr=slave)
            os.close(slave)
            chunks = []
            while True:
                try:
                    data = os.read(master, 65536)
                    if not data:
                        break
                    chunks.append(data)
                except OSError as error:
                    if error.errno == errno.EIO:
                        break
                    raise
            os.close(master)
            code, output = process.wait(timeout=30), b''.join(chunks).decode()
        else:
            result = subprocess.run(['bash', str(script), arg], cwd=root,
                                    env={**env, 'SIM_MODE': mode}, text=True,
                                    capture_output=True, timeout=30)
            code, output = result.returncode, result.stdout + result.stderr
        calls = (root / 'calls').read_text() if (root / 'calls').exists() else ''
        return code, output, calls

    code, out, calls = run('--prepare', 'missing_gas', True)
    assert code != 0 and '--check-old-testnet-deployer' in calls
    assert '--deploy-old-testnet-deployer' not in calls and 'systemd-run' not in calls

    code, out, calls = run('--prepare', 'ready', True)
    assert code == 0, out
    assert calls.index('--check-old-testnet-deployer') < calls.index('--deploy-old-testnet-deployer')
    assert 'keeper --init-wallet' in calls and 'systemd-run' in calls
    assert 'V3_HOURLY_SITE_STARTED_NOT_YET_CONFIRMED' in out

    code, out, calls = run('--prepare', 'installed', True)
    assert code == 0 and 'PREVIOUSLY_CONFIRMED' in out
    assert '--deploy-old-testnet-deployer' not in calls and 'systemd-run' not in calls

    code, out, calls = run('--start-keeper', 'site_missing')
    assert code != 0 and 'SITE_NOT_YET_CONFIRMED' in out and 'keeper --check' not in calls
    code, out, calls = run('--start-keeper', 'keeper_blocked')
    assert code != 0 and 'keeper --check' in calls and 'keeper --install' not in calls
    code, out, calls = run('--start-keeper', 'ready')
    assert code == 0 and calls.index('keeper --check') < calls.index('keeper --install')
    code, out, calls = run('--start-keeper', 'enabled')
    assert code == 0 and 'ALREADY_ENABLED' in out and 'keeper --install' not in calls
    print('PASS hourly setup gas gate, separate deployment, site launch and keeper readiness')

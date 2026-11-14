import os
from pathlib import Path
import subprocess
import tempfile

inner = Path(__file__).with_name('start-v3-routed-keeper-145f.sh').read_text()
expected = '145f90b247202e40e5a1b9fd0216ea3ac8716b31'

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    for directory in ['bin', 'opt/global-commerce.test/.git',
                      'opt/global-commerce.test/scripts',
                      'opt/global-commerce.test/node_modules/ethers',
                      'opt/global-commerce.test/node_modules/solc',
                      'etc/globaldroptrade', 'etc/systemd/system',
                      'var/lib/globaldroptrade/v3-routed-testnet']:
        (root / directory).mkdir(parents=True, exist_ok=True)
    for prefix in ['/opt/', '/etc/', '/var/']:
        inner = inner.replace(prefix, str(root) + prefix)
    work = root / 'opt/global-commerce.test'
    script = root / 'inner.sh'
    script.write_text(inner)
    (root / 'etc/globaldroptrade/v3-routed-keeper-testnet.json').write_text('{}')
    (root / 'var/lib/globaldroptrade/v3-routed-testnet/site-install-unit').write_text(
        'global-v3-site-145f90b247-1794657880.service\n')
    stubs = {
        'id': 'if [[ "$1" == -u && "$TEST_MODE" == nonroot ]]; then echo 1000; else echo 0; fi',
        'git': f'''if [[ "$3" == rev-parse ]]; then echo {expected}; exit 0; fi
if [[ "$3" == diff && -f "{root}/dirty" ]]; then exit 1; fi
exit 0''',
        'systemctl': f'''if [[ "$1" == is-active ]]; then [[ -f "{root}/active" ]]; exit $?; fi
if [[ "$1" == cat ]]; then [[ -f "{root}/existing" ]]; exit $?; fi
exit 1''',
        'journalctl': 'echo V3_TESTNET_PRIMARY_DASHBOARD_INSTALLED',
        'node': f'echo verified >> "{root}/calls"; exit 0',
    }
    for name, body in stubs.items():
        file = root / 'bin' / name
        file.write_text('#!/bin/bash\n' + body + '\n')
        file.chmod(0o755)
    installer = work / 'scripts/install-global-v3-keeper-timer.sh'
    installer.write_text(f'''#!/bin/bash
echo "$1" >> "{root}/calls"
case "$1" in
 --init-wallet) echo V3_KEEPER_GAS_ONLY_PUBLIC_ADDRESS=0x1111111111111111111111111111111111111111;;
 --check)
  case "$TEST_MODE" in
   gas) echo 'V3_AUTO_COMPOUND_BLOCKED GAS_ONLY_KEEPER_HAS_TOO_LITTLE_TEST_BNB'; exit 1;;
   fail) echo 'V3_AUTO_COMPOUND_BLOCKED V3_PINNED_CHAIN97_CONFIG_REQUIRED'; exit 2;;
   *) echo V3_KEEPER_PREFLIGHT_PASS=YES;;
  esac;;
 --install) touch "{root}/active"; echo V3_FIRST_RUN_REQUESTED_NOT_YET_VERIFIED;;
esac
''')
    env = {**os.environ, 'PATH': str(root / 'bin') + ':' + os.environ['PATH']}
    def run(mode):
        (root / 'calls').unlink(missing_ok=True)
        result = subprocess.run(['bash', str(script)], cwd=work,
                                env={**env, 'TEST_MODE': mode}, text=True, capture_output=True)
        calls = (root / 'calls').read_text() if (root / 'calls').exists() else ''
        return result, calls
    nonroot, calls = run('nonroot')
    assert nonroot.returncode != 0 and 'V3_KEEPER_ROOT_REQUIRED' in nonroot.stdout and not calls
    gas, calls = run('gas')
    assert gas.returncode == 0 and 'V3_ROUTED_KEEPER_WAITING_FOR_TESTNET_GAS' in gas.stdout
    assert '--init-wallet' in calls and '--check' in calls and '--install' not in calls
    assert '0x1111111111111111111111111111111111111111' in gas.stdout
    fail, calls = run('fail')
    assert fail.returncode != 0 and 'V3_ROUTED_KEEPER_CHECK_FAILED' in fail.stdout and '--install' not in calls
    ready, calls = run('ready')
    assert ready.returncode == 0 and 'V3_ROUTED_KEEPER_TIMER_ACTIVE_FIRST_RUN_NOT_YET_CONFIRMED' in ready.stdout
    assert calls.index('verified') < calls.index('--init-wallet') < calls.index('--check') < calls.index('--install')
    active, calls = run('ready')
    assert active.returncode == 0 and 'V3_ROUTED_KEEPER_TIMER_ALREADY_ACTIVE' in active.stdout and not calls
    (root / 'active').unlink()
    (root / 'existing').touch()
    existing, calls = run('ready')
    assert existing.returncode != 0 and 'V3_ROUTED_KEEPER_EXISTING_UNITS_REQUIRE_REVIEW' in existing.stdout and not calls
    (root / 'existing').unlink()
    (root / 'dirty').touch()
    dirty, calls = run('ready')
    assert dirty.returncode != 0 and 'V3_KEEPER_REVIEWED_CHECKOUT_NOT_FOUND' in dirty.stdout and not calls
    (root / 'dirty').unlink()
    (root / 'etc/globaldroptrade/v3-routed-keeper-testnet.json').unlink()
    missing, calls = run('ready')
    assert missing.returncode != 0 and 'V3_KEEPER_CONFIG_MISSING' in missing.stdout and not calls
    print('PASS: verified source, gas wait, ready install, idempotency and fail-closed checks')

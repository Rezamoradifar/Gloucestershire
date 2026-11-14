"""Test generated keeper units without running systemd or touching real credentials."""
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

repo = Path(__file__).resolve().parent.parent
real_stat = shutil.which('stat')
real_analyze = shutil.which('systemd-analyze')
assert real_stat and real_analyze
credential_dir = '$' + '{CREDENTIALS_DIRECTORY}'

def exercise(version, profile='routed-testnet', existing_symlink=False, fail_verify=False, fail_probe=False):
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        for directory in ['bin', 'scripts', 'etc/globaldroptrade', 'etc/systemd/system',
                          'var/lib/globaldroptrade/v3-routed-testnet',
                          'var/lib/globaldroptrade/v3-hourly-testnet', 'run/lock', 'tmp']:
            (root / directory).mkdir(parents=True, exist_ok=True)
        original = (repo / 'scripts/install-global-v3-keeper-timer.sh').read_text()
        original = re.sub(r'/(?:opt|etc|var|run|tmp)/', lambda match: str(root) + match.group(0), original)
        (root / 'scripts/install-global-v3-keeper-timer.sh').write_text(original)
        for name in ['scripts/global-v3-auto-compound-keeper.mjs',
                     'scripts/v3-keeper-receipt-poll.mjs', 'package.json', 'package-lock.json']:
            (root / name).write_bytes((repo / name).read_bytes())
        for name in ['v3-routed-keeper-testnet.json', 'v3-routed-keeper-testnet-gas-only.key',
                     'v3-keeper-testnet.json', 'v3-keeper-testnet-gas-only.key',
                     'v3-hourly-keeper-testnet.json', 'v3-hourly-keeper-testnet-gas-only.key']:
            (root / 'etc/globaldroptrade' / name).write_text('private-test-fixture')
        (root / 'var/lib/globaldroptrade/v3-routed-testnet/deployment.json').write_text('{}')
        (root / 'var/lib/globaldroptrade/v3-hourly-testnet/deployment.json').write_text('{}')
        (root / 'var/lib/globaldroptrade/v3-routed-testnet/site-install-unit').write_text(
            'global-v3-site-145f90b247-1794657880.service\n')
        service_name = ('global-v3-hourly-compound-keeper-testnet.service'
                        if profile == 'hourly-testnet' else 'global-v3-routed-compound-keeper-testnet.service')
        service = root / 'etc/systemd/system' / service_name
        if existing_symlink:
            service.symlink_to(root / 'missing-destination')
        stubs = {
            'id': 'echo 0',
            'stat': f"""if [[ "$1" == -Lc && "$2" == '%a:%u' ]]; then echo 600:0
elif [[ "$1" == -Lc && "$2" == %u ]]; then echo 0
else exec "{real_stat}" "$@"; fi""",
            'node': 'exit 0',
            'git': """if [[ "$1" == '-C' && "$3" == rev-parse ]]; then printf '%040d\\n' 1; fi
exit 0""",
            'npm': 'mkdir -p node_modules; exit 0',
            'journalctl': 'echo V3_TESTNET_PRIMARY_DASHBOARD_INSTALLED',
            'systemctl': f"""if [[ "$1" == --version ]]; then echo 'systemd {version} (mock)'; exit 0; fi
if [[ "$1" == cat ]]; then exit 1; fi
echo "$*" >> "{root}/systemctl-calls"; exit 0""",
            'systemd-run': f"""echo "$*" >> "{root}/probe-calls"
[[ "$*" == *--property=DynamicUser=yes* && "$*" == *--probe-systemd-credential* ]] || exit 1
[[ "$SIM_PROBE_FAIL" != 1 ]]""",
            'systemd-analyze': f"""service="$2"
if [[ "$SIM_VERIFY_FAIL" == 1 ]]; then echo 'Invalid slot' >&2; exit 1; fi
if grep -F '%d/' "$service" >/dev/null; then echo 'Invalid slot' >&2; exit 1; fi
grep -F '{credential_dir}/keeper-config' "$service" >/dev/null || exit 1
grep -F '{credential_dir}/keeper-gas-key' "$service" >/dev/null || exit 1
if [[ "$SIM_PROFILE" == routed-testnet || "$SIM_PROFILE" == hourly-testnet ]]; then
 grep -F '{credential_dir}/deployment-proof' "$service" >/dev/null || exit 1
fi
if grep -F '/tmp/SHOULD_NOT_EXPAND' "$service" >/dev/null; then exit 1; fi
cp "$service" "{root}/captured.service"
cp "$3" "{root}/captured.timer"
exec "{real_analyze}" "$@"
""",
        }
        for name, content in stubs.items():
            stub = root / 'bin' / name
            stub.write_text('#!/bin/bash\n' + content + '\n')
            stub.chmod(0o755)
        env = {**os.environ, 'PATH': str(root / 'bin') + ':' + os.environ['PATH'],
               'CREDENTIALS_DIRECTORY': '/tmp/SHOULD_NOT_EXPAND', 'SIM_PROFILE': profile,
               'SIM_VERIFY_FAIL': '1' if fail_verify else '0',
               'SIM_PROBE_FAIL': '1' if fail_probe else '0'}
        if profile in ('routed-testnet', 'hourly-testnet'):
            env['GLOBAL_V3_RELEASE_PROFILE'] = profile
        else:
            env.pop('GLOBAL_V3_RELEASE_PROFILE', None)
        result = subprocess.run(['bash', str(root / 'scripts/install-global-v3-keeper-timer.sh'), '--install'],
                                cwd=root, env=env, text=True, capture_output=True, timeout=30)
        calls = (root / 'systemctl-calls').read_text() if (root / 'systemctl-calls').exists() else ''
        if version < 247:
            assert result.returncode != 0 and 'SYSTEMD_247_OR_NEWER_REQUIRED' in result.stderr
            assert not calls and not service.exists() and not service.is_symlink()
        elif existing_symlink:
            assert result.returncode != 0 and 'KEEPER_TIMER_ALREADY_INSTALLED' in result.stderr
            assert service.is_symlink() and not calls
        elif fail_verify:
            assert result.returncode != 0 and 'UNITS_DID_NOT_VALIDATE' in result.stderr
            assert not service.exists() and not service.is_symlink() and not calls
        elif fail_probe:
            assert result.returncode != 0 and 'SYSTEMD_CREDENTIAL_PROBE_FAILED' in result.stderr
            assert not service.exists() and not service.is_symlink() and not calls
        else:
            assert result.returncode == 0, result.stdout + result.stderr
            unit = (root / 'captured.service').read_text()
            assert credential_dir + '/keeper-config' in unit
            assert credential_dir + '/keeper-gas-key' in unit
            assert '%d/' not in unit and '/tmp/SHOULD_NOT_EXPAND' not in unit
            assert (credential_dir + '/deployment-proof' in unit) == (profile in ('routed-testnet', 'hourly-testnet'))
            timer = (root / 'captured.timer').read_text()
            if profile == 'hourly-testnet':
                assert 'OnCalendar=*:0/2' in timer and 'RandomizedDelaySec=5s' in timer
                assert 'GLOBAL_V3_RELEASE_PROFILE=hourly-testnet' in unit
            else:
                assert 'OnCalendar=hourly' in timer
            assert 'enable --now' in calls and 'start --no-block' in calls
            assert '--probe-systemd-credential' in (root / 'probe-calls').read_text()
            assert 'private-test-fixture' not in result.stdout + result.stderr

exercise(249)
exercise(249, 'hourly-testnet')
exercise(257, 'original')
exercise(246)
exercise(249, existing_symlink=True)
exercise(249, fail_verify=True)
exercise(249, fail_probe=True)
print('PASS: credential paths, sandbox probe, profiles, version guard and failure safety')

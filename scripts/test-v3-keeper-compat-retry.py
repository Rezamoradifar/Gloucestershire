"""Exercise the fixed keeper retry without systemd, a network or private keys."""
import os
from pathlib import Path
import re
import subprocess
import tempfile

repo = Path(__file__).resolve().parent.parent
expected = 'a' * 40

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    for directory in ['bin', 'scripts', '.git', 'etc/systemd/system', 'opt']:
        (root / directory).mkdir(parents=True, exist_ok=True)
    source = (repo / 'scripts/retry-v3-routed-keeper-fixed.sh').read_text()
    source = re.sub(r'/(?:opt|etc)/', lambda match: str(root) + match.group(0), source)
    script = root / 'scripts/retry-v3-routed-keeper-fixed.sh'
    script.write_text(source)
    stubs = {
        'id': 'if [[ "$SIM_MODE" == nonroot ]]; then echo 1000; else echo 0; fi',
        'git': f"""if [[ "$1" == rev-parse ]]; then echo {expected}; exit 0; fi
if [[ "$1" == diff && "$SIM_MODE" == dirty ]]; then exit 1; fi
exit 0""",
        'systemctl': f"""if [[ "$1" == is-active ]]; then [[ -f "{root}/active" ]]; exit $?; fi
if [[ "$1" == cat ]]; then [[ -f "{root}/existing" ]]; exit $?; fi
exit 1""",
        'npm': f'echo npm >> "{root}/calls"; exit 0',
    }
    for name, text in stubs.items():
        file = root / 'bin' / name
        file.write_text('#!/bin/bash\n' + text + '\n')
        file.chmod(0o755)
    installer = root / 'scripts/install-global-v3-keeper-timer.sh'
    installer.write_text(f"""#!/bin/bash
echo "$1" >> "{root}/calls"
if [[ "$1" == --check && "$SIM_MODE" == fail_check ]]; then echo CHECK_BLOCKED; exit 1; fi
if [[ "$1" == --install && "$SIM_MODE" != not_active ]]; then touch "{root}/active"; fi
exit 0
""")
    env = {**os.environ, 'PATH': str(root / 'bin') + ':' + os.environ['PATH'],
           'GLOBAL_V3_KEEPER_FIX_SHA': expected}
    def run(mode, **extra):
        (root / 'calls').unlink(missing_ok=True)
        result = subprocess.run(['bash', str(script)], cwd=root,
                                env={**env, 'SIM_MODE': mode, **extra}, text=True, capture_output=True)
        calls = (root / 'calls').read_text() if (root / 'calls').exists() else ''
        return result, calls
    denied, calls = run('nonroot')
    assert denied.returncode != 0 and 'V3_KEEPER_ROOT_OR_ARGUMENTS_INVALID' in denied.stdout and not calls
    wrong, calls = run('ready', GLOBAL_V3_KEEPER_FIX_SHA='b' * 40)
    assert wrong.returncode != 0 and 'V3_KEEPER_FIX_SHA_INVALID' in wrong.stdout and not calls
    dirty, calls = run('dirty')
    assert dirty.returncode != 0 and 'V3_KEEPER_FIX_SOURCE_MODIFIED' in dirty.stdout and not calls
    (root / 'existing').touch()
    existing, calls = run('ready')
    assert existing.returncode != 0 and 'V3_ROUTED_KEEPER_EXISTING_UNITS_REQUIRE_REVIEW' in existing.stdout and not calls
    (root / 'existing').unlink()
    blocked, calls = run('fail_check')
    assert blocked.returncode != 0 and '--check' in calls and '--install' not in calls
    unavailable, calls = run('not_active')
    assert unavailable.returncode != 0 and 'V3_ROUTED_KEEPER_TIMER_NOT_ACTIVE' in unavailable.stdout
    ready, calls = run('ready')
    assert ready.returncode == 0 and 'V3_ROUTED_KEEPER_TIMER_ACTIVE_FIRST_RUN_NOT_YET_CONFIRMED' in ready.stdout
    assert calls.index('npm') < calls.index('--check') < calls.index('--install')
    active, calls = run('ready')
    assert active.returncode == 0 and 'V3_ROUTED_KEEPER_TIMER_ALREADY_ACTIVE' in active.stdout and not calls
    print('PASS: pinned source, existing-unit protection, readiness, activation and repeat run')

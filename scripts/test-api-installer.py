"""Check real API startup, service-readable release modes and installer rollback."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
from urllib.request import urlopen

repo = Path(__file__).resolve().parent.parent
real_node, setpriv = shutil.which('node'), shutil.which('setpriv')
assert real_node, 'Node is required for the real API entrypoint check'
assert os.geteuid() == 0, 'The API installer fixture requires root'
service_uid, service_gid = 65534, 65534
probe = subprocess.run([setpriv, '--reuid='+str(service_uid), '--regid='+str(service_gid), '--clear-groups', real_node,
                        '-e', 'process.stdout.write(String(process.getuid()))'], capture_output=True, text=True) if setpriv else None
can_drop_uid = probe is not None and probe.returncode == 0 and probe.stdout == str(service_uid)
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    root.chmod(0o755)
    for name in ['bin', 'server', 'scripts', 'artifacts', 'etc/systemd/system', 'etc/globaldroptrade', 'opt/api/releases']:
        (root/name).mkdir(parents=True, exist_ok=True)
    # Existing deployment containers may have inherited a restrictive setup umask too.
    (root/'opt/api').chmod(0o700)
    (root/'opt/api/releases').chmod(0o700)
    script = (repo/'ubuntu-api.sh').read_text().replace('/opt/globaldroptrade-api', str(root/'opt/api')).replace('/etc/globaldroptrade', str(root/'etc/globaldroptrade')).replace('/etc/systemd/system', str(root/'etc/systemd/system'))
    (root/'ubuntu-api.sh').write_text(script)
    copied = []
    for name in ['trades-api.mjs', 'community.mjs', 'marketplace.mjs', 'migration-service.mjs', 'trades.env.example']:
        destination = root/'server'/name
        destination.write_bytes((repo/'server'/name).read_bytes())
        copied.append(destination)
    for relative in ['scripts/deferred-migration-core.mjs', 'scripts/complete-rpc-logs.mjs', 'artifacts/TestnetDeferredMigrationVault.json', 'package.json', 'package-lock.json']:
        destination = root/relative
        destination.write_bytes((repo/relative).read_bytes())
        copied.append(destination)
    for file in copied:
        file.chmod(0o600)
    # Use the installed, locked production dependency graph without registry access.
    # Private fixture package modes reproduce dependencies created under umask 077.
    production = root/'production-fixture'
    pending, seen = list(json.loads((repo/'package.json').read_text())['dependencies']), set()
    while pending:
        name = pending.pop()
        if name in seen:
            continue
        seen.add(name)
        package = repo/'node_modules'/name
        assert package.is_dir(), 'Run npm ci before this installer check: '+name
        shutil.copytree(package, production/name, symlinks=True)
        pending.extend(json.loads((package/'package.json').read_text()).get('dependencies', {}))
    for file in sorted(production.rglob('*'), reverse=True):
        if not file.is_symlink():
            file.chmod(0o700 if file.is_dir() else 0o600)
    production.chmod(0o700)
    commands = {
        'node': f'exec "{real_node}" "$@"',
        'npm': f'mkdir -p node_modules\ncp -R "{production}/." node_modules/',
        'id': 'if [ "$1" = "-u" ]; then echo 0; fi; exit 0',
        'useradd': 'exit 0', 'sleep': 'exit 0',
        'systemctl': f'echo "$*" >> "{root}/calls"; exit 0',
        'curl': f'[ ! -f "{root}/unhealthy" ]',
    }
    for name, body in commands.items():
        file = root/'bin'/name
        file.write_text('#!/bin/bash\n'+body+'\n')
        file.chmod(0o755)
    environment = {**os.environ, 'PATH': str(root/'bin')+':'+os.environ['PATH']}
    envfile = root/'etc/globaldroptrade/trades.env'
    fresh_target = '0x1111111111111111111111111111111111111111'
    envfile.write_text('TRADES_CHAIN_ID=97\nTRADES_VAULT_ADDRESS='+fresh_target+'\nTRADES_RPC_URL=http://127.0.0.1:1/fixture-private\nGLOBAL_MIGRATION_ENABLED=false\n')
    envfile.chmod(0o600)

    def run():
        return subprocess.run(['bash', '-c', 'umask 077; exec bash "$1"', 'installer-fixture', str(root/'ubuntu-api.sh')],
                              cwd=root, env=environment, capture_output=True, text=True)

    result = run()
    assert result.returncode == 0, result.stderr
    current, unit = root/'opt/api/current', root/'etc/systemd/system/globaldroptrade-api.service'
    assert current.is_symlink() and (current/'server/trades-api.mjs').is_file()
    for relative in ['server/marketplace.mjs', 'server/migration-service.mjs', 'scripts/deferred-migration-core.mjs', 'scripts/complete-rpc-logs.mjs', 'artifacts/TestnetDeferredMigrationVault.json']:
        assert (current/relative).is_file()
    assert envfile.stat().st_mode & 0o777 == 0o600
    assert 'User=globaldroptrade-api' in unit.read_text() and 'ProtectSystem=strict' in unit.read_text()
    data = root/'service-state'
    data.mkdir(mode=0o700)
    if can_drop_uid:
        os.chown(data, service_uid, service_gid)
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', 0))
        port = reservation.getsockname()[1]
    child_env = {**os.environ, 'TRADES_CHAIN_ID': '97', 'TRADES_VAULT_ADDRESS': fresh_target,
                 'TRADES_RPC_URL': 'http://127.0.0.1:1/fixture-private', 'TRADES_PORT': str(port),
                 'GLOBAL_MIGRATION_ENABLED': 'false', 'COMMUNITY_DATA_FILE': str(data/'community.json')}
    command = [real_node, str(current/'server/trades-api.mjs')]
    if can_drop_uid:
        command = [setpriv, '--reuid='+str(service_uid), '--regid='+str(service_gid), '--clear-groups']+command
    child = subprocess.Popen(command, cwd='/', env=child_env,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        health = None
        deadline = time.monotonic()+5
        while time.monotonic() < deadline and child.poll() is None:
            try:
                with urlopen('http://127.0.0.1:'+str(port)+'/api/health', timeout=0.3) as response:
                    health = json.load(response)
                break
            except OSError:
                time.sleep(0.05)
        if health is None:
            child.terminate()
            stdout, stderr = child.communicate(timeout=3)
            raise AssertionError('Real installed API failed to start: '+stderr[-2000:])
        assert health['status'] == 'ok' and health['configured'] is True
        with urlopen('http://127.0.0.1:'+str(port)+'/api/config', timeout=1) as response:
            assert json.load(response) == {'version': 1, 'chainId': 97, 'vaultAddress': fresh_target}
    finally:
        if child.poll() is None:
            child.terminate()
        child.communicate(timeout=3)
    assert data.stat().st_mode & 0o777 == 0o700
    assert data.stat().st_uid == (service_uid if can_drop_uid else os.geteuid())
    entries = [root/'opt', root/'opt/api', root/'opt/api/releases', current.resolve(), *current.resolve().rglob('*')]
    for file in entries:
        if file.is_symlink():
            continue
        mode = file.stat().st_mode & 0o777
        assert mode & 0o044 == 0o044, 'Service cannot read release entry: '+str(file)
        if file.is_dir():
            assert mode & 0o011 == 0o011, 'Service cannot traverse release directory: '+str(file)
        assert not mode & 0o022, 'Release entry is writable by another account: '+str(file)
    envfile.write_text('TRADES_RPC_URL=https://example.invalid/keep-private\n')
    first = current.resolve()
    result = run()
    assert result.returncode == 0, result.stderr
    assert current.resolve() != first and 'keep-private' in envfile.read_text()
    previous, old_unit = current.resolve(), unit.read_text()
    (root/'unhealthy').touch()
    result = run()
    assert result.returncode != 0
    assert current.resolve() == previous and unit.read_text() == old_unit and 'keep-private' in envfile.read_text()
    assert 'keep-private' not in result.stdout+result.stderr
    assert envfile.stat().st_mode & 0o777 == 0o600 and data.stat().st_mode & 0o777 == 0o700
    identity = 'unprivileged service UID' if can_drop_uid else 'current UID; UID drop unavailable, complete POSIX service-access modes verified'
    print('PASS: real installed API HTTP/config ('+identity+'); private source/dependencies under umask077 become service-readable; private env/data preserved; failed health restores previous service/release.')

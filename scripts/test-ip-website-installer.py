"""Check temporary-IP routing, preservation, and rollback with mock services."""
import os
import subprocess
import tempfile
from pathlib import Path

source = Path('scripts/install-website.sh').read_text()
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    for name in ('nginx/sites-available', 'nginx/sites-enabled', 'bin', 'site'):
        (root / name).mkdir(parents=True)
    (root / 'site/index.html').write_text('GLOBAL latest frontend')
    domain = root / 'nginx/sites-available/globaldroptrade.com'
    domain.write_text('existing domain SSL configuration')
    default = root / 'nginx/sites-enabled/default'
    default.write_text('existing default website')
    conf = root / 'nginx/sites-available/globaldroptrade-ip-104.167.16.102'
    link = root / 'nginx/sites-enabled/globaldroptrade-ip-104.167.16.102'
    (root / 'install.sh').write_text(source.replace('/etc/nginx/', str(root / 'nginx') + '/').replace('/var/www/globaldroptrade/', str(root / 'www') + '/').replace('/var/log/globaldroptrade', str(root / 'diagnostics')))
    (root / 'bin/nginx').write_text(f'''#!/bin/bash
if [ "$1" = '-T' ]; then cat '{root}/nginx.dump'; fi
if [ "$1" = '-t' ] && [ -f '{root}/nginx-fail' ] && [ -f '{conf}' ] && ! grep -q '/releases/old;' '{conf}'; then exit 1; fi
if [ "$1" = '-t' ] && [ -f '{root}/conflict-warning' ]; then echo 'conflicting server name "104.167.16.102" on 0.0.0.0:8961, ignored'; fi
exit 0
''')
    (root / 'bin/systemctl').write_text('#!/bin/bash\nexit 0\n')
    (root / 'bin/sleep').write_text('#!/bin/bash\nexit 0\n')
    (root / 'bin/curl').write_text(f'''#!/bin/bash
printf '%s\\n' "$*" >> '{root}/curl-calls'
count=$(cat '{root}/curl-count'); count=$((count+1)); echo "$count" > '{root}/curl-count'
output=''; headers=''
while [ "$#" -gt 0 ]; do
 if [ "$1" = '-o' ]; then output=$2; fi
 if [ "$1" = '-D' ]; then headers=$2; fi
 shift
done
if [ -f '{root}/health-fail' ] || {{ [ -f '{root}/health-transient-error' ] && [ "$count" -lt 3 ]; }}; then
 echo 'HTTP/1.1 503 Service Unavailable' > "$headers"; printf 503; exit 22
fi
echo 'HTTP/1.1 200 OK' > "$headers"; printf 200
if [ -f '{root}/health-wrong' ] || {{ [ -f '{root}/health-delay' ] && [ "$count" -lt 3 ]; }}; then
 echo 'OLD WORKER FRONTEND' > "$output"
else cp '{root}/site/index.html' "$output"; fi
''')
    for executable in (root / 'bin').iterdir():
        executable.chmod(0o755)
    (root / 'nginx.dump').write_text('server_name globaldroptrade.com www.globaldroptrade.com;\n')
    env = {**os.environ, 'PATH': str(root / 'bin') + ':' + os.environ['PATH'], 'GLOBAL_SITE_IP': '104.167.16.102'}
    def run(**changes):
        (root / 'curl-count').write_text('0')
        return subprocess.run(['bash', str(root / 'install.sh')], env={**env, **changes}, capture_output=True, text=True)
    for invalid in ('104.167.16.999', '104.167.016.102', '104.167.16.102;bad'):
        assert run(GLOBAL_SITE_IP=invalid).returncode != 0
    (root / 'nginx.dump').write_text('server_name example.com 104.167.16.102;\n')
    assert run().returncode != 0 and not conf.exists()
    (root / 'nginx.dump').write_text('server_name globaldroptrade.com www.globaldroptrade.com;\n')
    result = run()
    assert result.returncode == 0, result.stdout + result.stderr
    assert link.is_symlink() and 'server_name 104.167.16.102;' in conf.read_text()
    assert 'SITE_READY http://104.167.16.102' in result.stdout
    first = conf.read_text()
    assert run().returncode == 0 and conf.read_text() != first
    original = f'server {{\n    listen 80;\n    server_name 104.167.16.102;\n    root {root}/www/releases/old;\n}}\n'
    conf.write_text(original)
    (root / 'nginx-fail').touch()
    assert run().returncode != 0 and conf.read_text() == original
    (root / 'nginx-fail').unlink()
    (root / 'health-fail').touch()
    assert run().returncode != 0 and conf.read_text() == original
    assert domain.read_text() == 'existing domain SSL configuration'
    assert default.read_text() == 'existing default website'
    (root / 'health-fail').unlink()
    for invalid in ('0', '65536', '08961', '8961;bad'):
        assert run(GLOBAL_SITE_PORT=invalid).returncode != 0
    (root / 'nginx.dump').write_text('server_name 104.167.16.102;\n')
    result = run(GLOBAL_SITE_PORT='8961')
    assert result.returncode == 0, result.stdout + result.stderr
    port_conf = root / 'nginx/sites-available/globaldroptrade-ip-104.167.16.102-8961'
    assert 'listen 8961;' in port_conf.read_text() and 'listen [::]:8961;' in port_conf.read_text()
    assert 'SITE_READY http://104.167.16.102:8961' in result.stdout
    assert 'http://127.0.0.1:8961/' in (root / 'curl-calls').read_text()
    assert conf.read_text() == original
    previous = port_conf.read_text()
    for flag in ('health-delay', 'health-transient-error'):
        (root / flag).touch()
        result = run(GLOBAL_SITE_PORT='8961')
        (root / flag).unlink()
        assert result.returncode == 0, result.stdout + result.stderr
        assert 'SITE_READY http://104.167.16.102:8961' in result.stdout
        assert (root / 'curl-count').read_text().strip() == '3'
    previous = port_conf.read_text()
    (root / 'health-wrong').touch()
    result = run(GLOBAL_SITE_PORT='8961')
    (root / 'health-wrong').unlink()
    assert result.returncode != 0 and port_conf.read_text() == previous
    assert 'SITE_READY' not in result.stdout and 'Last HTTP status: 200' in result.stdout
    assert 'Expected HTML:' in result.stdout and 'Received HTML:' in result.stdout
    assert (root / 'curl-count').read_text().strip() == '10'
    assert list((root / 'diagnostics').glob('*/served.html'))
    calls = (root / 'curl-calls').read_text()
    assert '--noproxy *' in calls and 'Host: 104.167.16.102:8961' in calls and '?global_release=' in calls
    (root / 'conflict-warning').touch()
    assert run(GLOBAL_SITE_PORT='8961').returncode != 0
    assert port_conf.read_text() == previous
    print('PASS: IP/port validation; collisions; port 8961 routing; existing hosts preserved; delayed reload and transient HTTP recovery; persistent mismatch rolls back with diagnostics; proxy bypass; duplicate-host rejection.')

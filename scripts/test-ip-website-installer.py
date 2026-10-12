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
    (root / 'install.sh').write_text(source.replace('/etc/nginx/', str(root / 'nginx') + '/').replace('/var/www/globaldroptrade/', str(root / 'www') + '/'))
    (root / 'bin/nginx').write_text(f'''#!/bin/bash
if [ "$1" = '-T' ]; then cat '{root}/nginx.dump'; fi
if [ "$1" = '-t' ] && [ -f '{root}/nginx-fail' ] && [ -f '{conf}' ] && ! grep -q '/releases/old;' '{conf}'; then exit 1; fi
if [ "$1" = '-t' ] && [ -f '{root}/conflict-warning' ]; then echo 'conflicting server name "104.167.16.102" on 0.0.0.0:8961, ignored'; fi
exit 0
''')
    (root / 'bin/systemctl').write_text('#!/bin/bash\nexit 0\n')
    (root / 'bin/curl').write_text(f'''#!/bin/bash
printf '%s\\n' "$*" >> '{root}/curl-calls'
[ ! -f '{root}/health-fail' ] || exit 22
while [ "$#" -gt 0 ]; do
 if [ "$1" = '-o' ]; then cp '{root}/site/index.html' "$2"; exit 0; fi
 shift
done
exit 1
''')
    for executable in (root / 'bin').iterdir():
        executable.chmod(0o755)
    (root / 'nginx.dump').write_text('server_name globaldroptrade.com www.globaldroptrade.com;\n')
    env = {**os.environ, 'PATH': str(root / 'bin') + ':' + os.environ['PATH'], 'GLOBAL_SITE_IP': '104.167.16.102'}
    def run(**changes):
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
    (root / 'conflict-warning').touch()
    assert run(GLOBAL_SITE_PORT='8961').returncode != 0
    assert port_conf.read_text() == previous
    print('PASS: IP and port validation; host collision; port 8961 routing and local HTTP check; existing port 80 preserved; update and rollback; duplicate-host warning rejection.')

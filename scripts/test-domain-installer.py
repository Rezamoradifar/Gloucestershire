"""Check domain activation gates with mocked DNS, certificates and services."""
import os
import subprocess
import tempfile
from pathlib import Path

source = Path('ubuntu-domain.sh').read_text()
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    for name in ('bin', 'scripts', 'website/dist', 'deployment-console', 'nginx'):
        (root / name).mkdir(parents=True)
    (root / 'nginx/nginx.conf').write_text('existing nginx settings')
    (root / 'website/dist/index.html').write_text('GLOBAL verified testnet frontend')
    (root / 'deployment-console/index.html').write_text('deployment console')
    (root / 'ubuntu-domain.sh').write_text(source.replace('/var/backups/globaldroptrade', str(root / 'backups')).replace('/etc/nginx', str(root / 'nginx')))
    (root / 'ubuntu-ip-website.sh').write_text(f'''set -eu
test "$1" = 104.167.16.102
test "$2" = 8961
test "$VITE_CHAIN_ID" = 97
test "$VITE_VAULT_ADDRESS" = 0x7f19354B765920B9b17003d0840EEaA133883DcA
echo installed > '{root}/ip-installed'
''')
    (root / 'scripts/install-website.sh').write_text('test -z "${GLOBAL_SITE_IP:-}" && test -z "${GLOBAL_SITE_PORT:-}"\n')
    tools = {
        'id': 'echo 0',
        'python3': f"[ ! -f '{root}/dns-fail' ]",
        'nginx': 'exit 0',
        'ufw': 'echo "Status: inactive"',
        'systemctl': f'echo "$*" >> "{root}/service-calls"',
        'certbot': f'''printf '%s\\n' "$*" > '{root}/certbot-calls'
[ ! -f '{root}/cert-fail' ]''',
        'curl': f'''[ ! -f '{root}/https-fail' ] || exit 60
printf '%s\\n' "$*" >> '{root}/https-calls'
if [ -f '{root}/wrong-content' ]; then echo wrong > "${{@: -1}}"; else cp '{root}/website/dist/index.html' "${{@: -1}}"; fi''',
    }
    for name, body in tools.items():
        file = root / 'bin' / name
        file.write_text('#!/bin/bash\n' + body + '\n')
        file.chmod(0o755)
    env = {**os.environ, 'PATH': str(root / 'bin') + ':' + os.environ['PATH'], 'GLOBAL_SITE_IP': '192.0.2.1', 'GLOBAL_SITE_PORT': '9999'}
    def run():
        return subprocess.run(['bash', str(root / 'ubuntu-domain.sh')], env=env, capture_output=True, text=True)
    (root / 'dns-fail').touch()
    result = run()
    assert result.returncode != 0 and not (root / 'ip-installed').exists()
    (root / 'dns-fail').unlink()
    result = run()
    assert result.returncode == 0, result.stdout + result.stderr
    assert 'HTTPS_READY https://globaldroptrade.com' in result.stdout
    assert 'IP_SITE_PRESERVED http://104.167.16.102:8961' in result.stdout
    assert '--nginx' in (root / 'certbot-calls').read_text() and '--redirect' in (root / 'certbot-calls').read_text()
    assert 'certbot.timer' in (root / 'service-calls').read_text()
    assert 'https://globaldroptrade.com/' in (root / 'https-calls').read_text()
    assert 'https://www.globaldroptrade.com/' in (root / 'https-calls').read_text()
    assert list((root / 'backups').glob('*/nginx/nginx.conf'))
    for flag in ('cert-fail', 'https-fail', 'wrong-content'):
        (root / flag).touch()
        result = run()
        (root / flag).unlink()
        assert result.returncode != 0 and 'HTTPS_READY' not in result.stdout, flag
    print('PASS: DNS gate before changes; port 8961 preserved; domain mode; Nginx backup; certificate issuance flags; renewal timer; HTTPS and content failure gates.')

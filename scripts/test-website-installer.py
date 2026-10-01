import os,subprocess,tempfile
from pathlib import Path
source=Path('scripts/install-website.sh').read_text()
with tempfile.TemporaryDirectory() as d:
 p=Path(d);(p/'nginx/sites-available').mkdir(parents=True);(p/'nginx/sites-enabled').mkdir();(p/'bin').mkdir();(p/'site').mkdir();(p/'site/index.html').write_text('ok')
 conf=p/'nginx/sites-available/globaldroptrade.com';link=p/'nginx/sites-enabled/globaldroptrade.com';flag=p/'fail'
 testsource=source.replace('/etc/nginx/',str(p/'nginx')+'/').replace('/var/www/globaldroptrade/',str(p/'www')+'/');(p/'install.sh').write_text(testsource)
 (p/'bin/nginx').write_text(f'''#!/bin/bash
if [ "$1" = '-t' ] && [ -f '{flag}' ] && ! grep -q '/releases/old;' '{conf}'; then exit 1; fi
exit 0
''');(p/'bin/systemctl').write_text('#!/bin/bash\nexit 0\n')
 for f in (p/'bin').iterdir():f.chmod(0o755)
 env={**os.environ,'PATH':str(p/'bin')+':'+os.environ['PATH']}
 def run():return subprocess.run(['bash',str(p/'install.sh')],env=env,capture_output=True,text=True)
 a=run();assert a.returncode==0,a.stderr;assert link.is_symlink()
 original=f'''server {{\n    listen 443 ssl;\n    server_name globaldroptrade.com www.globaldroptrade.com;\n    root {p}/www/releases/old;\n    ssl_certificate /existing/certificate;\n}}\n''';conf.write_text(original)
 a=run();assert a.returncode==0,a.stderr;assert 'listen 443 ssl;' in conf.read_text() and 'ssl_certificate /existing/certificate;' in conf.read_text();assert '/releases/old;' not in conf.read_text()
 conf.write_text(original);flag.touch();a=run();assert a.returncode!=0;assert conf.read_text()==original
 print('PASS: initial installation; update preserves SSL; failed nginx check restores original config (mock services).')

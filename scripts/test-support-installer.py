"""Exercise support release success, rollback and preflight without host changes."""
import io,json,os,subprocess,tarfile,tempfile
from pathlib import Path
source=Path('ubuntu-support.sh').read_text()
with tempfile.TemporaryDirectory(prefix='support-install-test-') as temporary:
 p=Path(temporary);(p/'bin').mkdir();(p/'scripts').mkdir();(p/'nginx/sites-available').mkdir(parents=True);(p/'nginx/snippets').mkdir();(p/'www/releases/old/deploy').mkdir(parents=True)
 (p/'connection').mkdir(mode=0o700)
 old=p/'www/releases/old';(old/'index.html').write_text('old');(old/'deploy/activation.json').write_text('financial-status-preserved')
 conf=p/'nginx/sites-available/globaldroptrade.com';original=f'server {{\n root {old};\n}}\n';conf.write_text(original)
 snippet=p/'nginx/snippets/globaldroptrade-api.conf';snippet.write_text('old-api')
 target={'version':1,'chainId':97,'vaultAddress':'0x04E26FcaA198d21cEf6d04e1e54f9C5f6399e522'}
 (p/'config.json').write_text(json.dumps(target));(p/'announcements.json').write_text('{"items":[]}')
 installer=f'''#!/bin/bash
set -e
cd -- "$(dirname -- "${{BASH_SOURCE[0]}}")"
[ "$(cat site/deploy/activation.json)" = financial-status-preserved ]
cp -R site '{p}/www/releases/new'
printf 'new-config' > '{conf}'
printf 'new-api' > '{snippet}'
'''
 archive=p/'package.tar.gz'
 with tarfile.open(archive,'w:gz') as tar:
  for name,data in [('install.sh',installer),('site/index.html','new')]:
   data=data.encode();info=tarfile.TarInfo('globaldroptrade-package/'+name);info.size=len(data);info.mode=0o755 if name.endswith('.sh') else 0o644;tar.addfile(info,io.BytesIO(data))
 (p/'scripts/unpack-website.sh').write_text(f'#!/bin/bash\ncp {archive} "$1/website-release.tar.gz"\n')
 script=source.replace('/var/lib/globaldroptrade/fresh-fast-testnet-connection',str(p/'connection')).replace('/etc/nginx/',str(p/'nginx')+'/').replace('/var/www/globaldroptrade/',str(p/'www')+'/').replace('/var/backups/globaldroptrade',str(p/'backups')).replace('df -Pk /var/www','df -Pk '+str(p)).replace('df -Pi /var/www','df -Pi '+str(p)).replace('sleep 1',':')
 (p/'ubuntu-support.sh').write_text(script)
 (p/'bin/curl').write_text(f'''#!/bin/bash
out='';url=''
while [ "$#" -gt 0 ]; do case "$1" in -o) out=$2;shift 2;; https:*) url=$1;shift;; *) shift;; esac;done
case "$url" in */api/config) cp '{p}/config.json' "$out";; */announcements) cp '{p}/announcements.json' "$out";; *) if [ -f '{p}/bad-health' ];then printf broken > "$out";else printf new > "$out";fi;; esac
''')
 for command in ['nginx','systemctl']:(p/'bin'/command).write_text('#!/bin/bash\nexit 0\n')
 for f in (p/'bin').iterdir():f.chmod(0o755)
 env={**os.environ,'PATH':str(p/'bin')+':'+os.environ['PATH']}
 def run():return subprocess.run(['bash',str(p/'ubuntu-support.sh')],env=env,capture_output=True,text=True)
 result=run();assert result.returncode==0,result.stdout+result.stderr;assert 'GLOBAL_SUPPORT_FRONTEND_READY' in result.stdout;assert (old/'deploy/activation.json').read_text()=='financial-status-preserved'
 conf.write_text(original);snippet.write_text('old-api');(p/'bad-health').touch()
 result=run();assert result.returncode!=0;assert 'recoveryVerified=1' in result.stdout,result.stdout+result.stderr;assert conf.read_text()==original;assert snippet.read_text()=='old-api'
 (p/'bad-health').unlink();target['chainId']=56;(p/'config.json').write_text(json.dumps(target))
 result=run();assert result.returncode!=0;assert 'CONNECTED_FAST_TESTNET_REQUIRED' in result.stderr;assert conf.read_text()==original
 print('PASS: support update preserves consoles, rolls back HTTPS failure and rejects other networks.')

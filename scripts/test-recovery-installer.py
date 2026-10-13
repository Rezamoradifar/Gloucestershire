"""Exercise report preservation and failure reporting without contacting a VPS."""
from pathlib import Path
import os,subprocess,tempfile
source=Path('ubuntu-recover.sh').read_text()
with tempfile.TemporaryDirectory() as directory:
    root=Path(directory);site=root/'repo';site.mkdir();(site/'website/public').mkdir(parents=True)
    published=root/'published';published.mkdir();(published/'testnet-plan.json').write_text('{"published":true}')
    (published/'customer-secret.json').write_text('must not copy')
    conf=root/'site.conf';conf.write_text(f'root {published};\n')
    state=root/'state';(state/'million-test-v1').mkdir(parents=True)
    (state/'million-test-v1/million-public.json').write_text('{"completed":true}')
    (state/'million-test-v1/private-key.json').write_text('must not copy')
    script=source.replace('/root/global-testnet-v071/.testnet-server',str(state)).replace('/etc/nginx/sites-available/globaldroptrade.com',str(conf)).replace('/var/www/globaldroptrade/releases/',str(root)+'/').replace('runtime_root=/opt/globaldroptrade-runtime',f'runtime_root={root}/runtime')
    (site/'ubuntu-recover.sh').write_text(script)
    node=site/'.runtime/node-v22.23.3-linux-x64/bin';node.mkdir(parents=True)
    (node/'node').write_text('#!/bin/sh\nexit 0\n');(node/'node').chmod(0o755)
    (site/'ubuntu-domain.sh').write_text('#!/bin/sh\nexit 0\n')
    (site/'ubuntu-api.sh').write_text(f'#!/bin/sh\ncommand -v node > "{root}/selected-node"\n')
    tools=root/'tools';tools.mkdir()
    for name,body in {'id':'echo 0','uname':'echo x86_64','curl':f'if [ -f "{root}/unhealthy" ]; then exit 22; fi\necho \'{{"status":"ok","configured":false}}\''}.items():
        p=tools/name;p.write_text('#!/bin/sh\n'+body+'\n');p.chmod(0o755)
    env={**os.environ,'PATH':str(tools)+':'+os.environ['PATH']}
    def run():return subprocess.run(['bash',str(site/'ubuntu-recover.sh')],env=env,capture_output=True,text=True)
    result=run();assert result.returncode==0,result.stderr
    public=site/'website/public'
    assert (public/'testnet-plan.json').read_text()=='{"published":true}'
    assert (public/'testnet-million.json').read_text()=='{"completed":true}'
    assert not (public/'customer-secret.json').exists() and not (public/'private-key.json').exists()
    assert str(root/'runtime') in (root/'selected-node').read_text()
    runtime=root/'runtime/node-v22.23.3-linux-x64';assert runtime.stat().st_mode&0o005==0o005
    (root/'unhealthy').touch();result=run();assert result.returncode!=0
    assert 'GLOBAL_RECOVERY_INSTALLED' not in result.stdout
    print('PASS: published and journal report preservation; no private files published; system-readable runtime; failed health never reports success (mock services).')

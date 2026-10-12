"""Exercise connection activation ordering and rollback with mocked host services."""
import json, os, shutil, subprocess, tempfile
from pathlib import Path
root=Path(__file__).resolve().parent.parent
real_node=shutil.which('node')
with tempfile.TemporaryDirectory() as directory:
    p=Path(directory); release=p/'release'; source=p/'existing'; bin=p/'bin'; etc=p/'etc/globaldroptrade'
    for d in [release,source,bin,etc]:d.mkdir(parents=True)
    (release/'deployment-console').mkdir();(release/'website/dist').mkdir(parents=True)
    script=(root/'ubuntu-connect.sh').read_text().replace('/etc/globaldroptrade',str(etc))
    (release/'ubuntu-connect.sh').write_text(script)
    address='0x1111111111111111111111111111111111111111'
    report={'chainId':97,'contractAddress':address,'requestedPlanChecksMatch':False}
    active={'chainId':97,'contract':address,'status':'live'}
    scripts={
      'node':f'''if [ "$1" = scripts/connect-settlement-feed.mjs ]; then
        [ ! -f '{p}/preflight-fail' ] || exit 1
        printf '%s' '{json.dumps(report)}' > "$3/connection-public.json"
        printf '%s\\n' 'TRADES_CHAIN_ID=97' 'TRADES_RPC_URL=https://rpc.invalid/new-private' > "$3/trades.env"
        exit 0
      fi
      exec '{real_node}' "$@"''',
      'id':'echo 0', 'nginx':'exit 0', 'systemctl':'exit 0',
      'npm':f'echo build >> "{p}/build-calls"', 'python3':'exit 0',
      'curl':f'''[ ! -f '{p}/api-fail' ] || exit 22
      if [[ "$*" = *https://globaldroptrade.com* ]] && [ -f '{p}/https-fail' ]; then exit 60; fi
      if [[ "$*" = *http://127.0.0.1:8961/* ]]; then
        [ ! -f '{p}/ip-fail' ] || exit 22
        printf '%s' "$*" > '{p}/ip-check'
      fi
      printf '%s' '{json.dumps(active)}' > "${{@: -1}}"'''
    }
    for name,body in scripts.items():
        f=bin/name;f.write_text('#!/bin/bash\n'+body+'\n');f.chmod(0o755)
    (release/'ubuntu-api.sh').write_text(f'[ ! -f "{p}/install-fail" ]\n')
    (release/'ubuntu-website.sh').write_text('exit 0\n')
    env={**os.environ,'PATH':str(bin)+':'+os.environ['PATH']}
    def run():return subprocess.run(['bash',str(release/'ubuntu-connect.sh'),str(source)],env=env,capture_output=True,text=True)
    result=run();assert result.returncode==0,result.stderr
    assert 'HTTPS_SITE_AND_READ_ONLY_FEED_CONNECTED' in result.stdout
    assert 'new-private' not in result.stdout+result.stderr
    envfile=etc/'trades.env';assert envfile.stat().st_mode&0o777==0o600
    original='TRADES_RPC_URL=https://rpc.invalid/original-private\nCUSTOM=keep\n'
    envfile.write_text(original)
    for failure in ['preflight-fail','install-fail','api-fail']:
        (p/failure).touch();result=run();(p/failure).unlink()
        assert result.returncode!=0 and envfile.read_text()==original,(failure,result.stdout,result.stderr)
        assert 'HTTPS_SITE_AND_READ_ONLY_FEED_CONNECTED' not in result.stdout
        assert 'original-private' not in result.stdout+result.stderr
    (p/'https-fail').touch();result=run()
    assert result.returncode!=0 and 'HTTPS_SITE_AND_READ_ONLY_FEED_CONNECTED' not in result.stdout
    env.update(GLOBAL_SITE_IP='104.167.16.102',GLOBAL_SITE_PORT='8961')
    result=run();assert result.returncode==0,result.stdout+result.stderr
    assert 'IP_SITE_AND_READ_ONLY_FEED_CONNECTED http://104.167.16.102:8961' in result.stdout
    assert 'Host: 104.167.16.102' in (p/'ip-check').read_text()
    (p/'ip-fail').touch();result=run()
    assert result.returncode!=0 and 'IP_SITE_AND_READ_ONLY_FEED_CONNECTED' not in result.stdout
    print('PASS: connection preflight; settings preservation; API rollback; HTTPS and port 8961 public feed checks; failed host checks never report success (mock host services).')

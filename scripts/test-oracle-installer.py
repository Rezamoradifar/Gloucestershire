"""Exercise timer setup and rollback without touching host services or sending transactions."""
import os, shutil, subprocess, tempfile
from pathlib import Path

root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory() as directory:
    p=Path(directory);source=p/'source';etc=p/'etc/globaldroptrade';units=p/'etc/systemd/system'
    runtime=p/'opt/runtime/node-v22.23.3-linux-x64/bin';state=p/'var/lib/globaldroptrade/oracle-maintenance-v1'
    for d in [source/'scripts',source/'artifacts',etc,units,runtime,state]:d.mkdir(parents=True)
    script=(root/'ubuntu-testnet-oracles.sh').read_text()
    for old,new in [('/opt/globaldroptrade-node',str(p/'opt/runtime')),('/opt/globaldroptrade-oracles',str(p/'opt/oracles')),('/etc/globaldroptrade',str(etc)),('/etc/systemd/system',str(units)),('/var/lib/globaldroptrade',str(p/'var/lib/globaldroptrade'))]:script=script.replace(old,new)
    (source/'ubuntu-testnet-oracles.sh').write_text(script)
    for f in ['package.json','package-lock.json','artifacts/MockFeed.json','scripts/maintain-testnet-oracles.mjs','scripts/refresh-testnet-oracles.mjs','scripts/migration-signers.mjs','scripts/migration-journal.mjs']:
        shutil.copyfile(root/f,source/f)
    config='TRADES_CHAIN_ID=97\nTRADES_RPC_URL=https://private.invalid/secret\n'
    (etc/'trades.env').write_text(config);(state/'journal.json').write_text('preserve-signed-journal')
    mocks={
        'node':f'[ ! -f "{p}/preflight-fail" ]',
        'npm':'exit 0', 'id':'echo 0', 'uname':'echo x86_64', 'journalctl':'echo MOCK_JOURNAL',
        'systemctl':f'''echo "$*" >> '{p}/calls'
if [ "$1" = is-enabled ]; then [ -f '{p}/enabled' ]; exit $?; fi
if [ "$1" = enable ]; then touch '{p}/enabled'; fi
if [ "$1" = disable ]; then rm -f '{p}/enabled'; fi
if [ "$1" = daemon-reload ] && [ -f '{p}/reload-fail' ]; then rm '{p}/reload-fail'; exit 1; fi
if [ "$1" = start ] && [ -f '{p}/refresh-fail' ]; then exit 1; fi
exit 0'''
    }
    for name,body in mocks.items():
        f=runtime/name;f.write_text('#!/bin/bash\n'+body+'\n');f.chmod(0o755)
    env={**os.environ,'PATH':str(runtime)+':'+os.environ['PATH']}
    def run():return subprocess.run(['bash',str(source/'ubuntu-testnet-oracles.sh')],env=env,capture_output=True,text=True)
    (p/'preflight-fail').touch();r=run();assert r.returncode!=0 and not list(units.iterdir()),r.stdout+r.stderr
    (p/'preflight-fail').unlink();r=run();assert r.returncode==0,r.stdout+r.stderr
    assert 'GLOBAL_TESTNET_ORACLE_MAINTENANCE_READY' in r.stdout
    service=units/'globaldroptrade-oracles.service';timer=units/'globaldroptrade-oracles.timer'
    assert 'ProtectSystem=strict' in service.read_text() and 'run.lock' in service.read_text()
    assert 'OnCalendar=*:0/5' in timer.read_text() and 'Persistent=true' in timer.read_text()
    assert (etc/'trades.env').read_text()==config and (state/'journal.json').read_text()=='preserve-signed-journal'
    previous_service=service.read_text();previous_timer=timer.read_text()
    (p/'reload-fail').touch();r=run();assert r.returncode!=0
    assert service.read_text()==previous_service and timer.read_text()==previous_timer and (p/'enabled').exists()
    (p/'refresh-fail').touch();r=run();assert r.returncode!=0
    assert 'ORACLE_MAINTENANCE_INSTALLED_RETRY_PENDING' in r.stdout and 'GLOBAL_TESTNET_ORACLE_MAINTENANCE_READY' not in r.stdout
    assert (p/'enabled').exists() and (state/'journal.json').read_text()=='preserve-signed-journal'
    assert 'secret' not in r.stdout+r.stderr
    print('PASS: read-only preflight gates installation; timer persists; units roll back; failed first refresh keeps retries and journal; API settings unchanged.')

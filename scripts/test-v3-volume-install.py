#!/usr/bin/env python3
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

repo=Path(__file__).resolve().parent.parent
real_stat=shutil.which('stat')
real_analyze=shutil.which('systemd-analyze')
assert real_stat and real_analyze

def exercise(mode):
 with tempfile.TemporaryDirectory(prefix='v3-volume-installer-') as tmp:
  root=Path(tmp)
  for d in ['bin','scripts','.git','etc/globaldroptrade','etc/systemd/system',
            'var/lib/globaldroptrade/v3-hourly-testnet','run/lock','tmp']:
   (root/d).mkdir(parents=True,exist_ok=True)
  source=(repo/'scripts/v3-volume-install.sh').read_text()
  source=re.sub(r'/(?:opt|etc|var|run|tmp)/',lambda m:str(root)+m.group(0),source)
  (root/'scripts/v3-volume-install.sh').write_text(source)
  for f in ['scripts/v3-volume-keeper.mjs','scripts/global-v3-auto-compound-keeper.mjs',
            'scripts/v3-keeper-receipt-poll.mjs','package.json','package-lock.json']:
   (root/f).write_bytes((repo/f).read_bytes())
  for f in ['v3-hourly-keeper-testnet.json','v3-hourly-volume-keeper-gas-only.key',
            'v3-hourly-keeper-testnet-gas-only.key',
            'v3-routed-keeper-testnet-gas-only.key','v3-keeper-testnet-gas-only.key']:
   (root/'etc/globaldroptrade'/f).write_text('private-test-fixture')
  if mode in ('routed_symlink','original_symlink'):
   key=('v3-routed-keeper-testnet-gas-only.key' if mode=='routed_symlink'
        else 'v3-keeper-testnet-gas-only.key')
   path=root/'etc/globaldroptrade'/key
   path.unlink();path.symlink_to(root/'missing-key')
  if mode=='missing_optional':
   for key in ('v3-routed-keeper-testnet-gas-only.key','v3-keeper-testnet-gas-only.key'):
    (root/'etc/globaldroptrade'/key).unlink()
  (root/'var/lib/globaldroptrade/v3-hourly-testnet/deployment.json').write_text('{}')
  unit=root/'etc/systemd/system/global-v3-hourly-network-volume-testnet.service'
  if mode=='symlink':unit.symlink_to(root/'missing')
  stubs={
   'id':'echo 0',
   'stat':f'''if [[ "$1" == -Lc && "$2" == '%a:%u' ]]; then echo 600:0
elif [[ "$1" == -Lc && "$2" == %u ]]; then echo 0
else exec "{real_stat}" "$@"; fi''',
   'git':"if [[ \"$1\" == rev-parse ]]; then printf '%040d\\n' 1; fi; exit 0",
   'node':'''if [[ "$2" == --address ]]; then echo V3_VOLUME_GAS_ONLY_ADDRESS=0x111; exit 0; fi
if [[ "$2" == --public-address ]]; then
 if [[ "$SIM_MODE" == same ||
       ( "$SIM_MODE" == routed_same && "$4" == *v3-routed-keeper-testnet-gas-only.key ) ||
       ( "$SIM_MODE" == original_same && "$4" == *v3-keeper-testnet-gas-only.key ) ]]; then
  echo V3_KEEPER_GAS_ONLY_PUBLIC_ADDRESS=0x111
 else echo V3_KEEPER_GAS_ONLY_PUBLIC_ADDRESS=0x222; fi; exit 0
fi
if [[ "$2" == --check && "$SIM_MODE" == insufficient ]]; then exit 1; fi
exit 0''',
   'npm':'mkdir -p node_modules; exit 0',
   'journalctl':'exit 0',
   'systemctl':f'''if [[ "$1" == --version ]]; then echo 'systemd 249 (mock)'; exit 0; fi
if [[ "$1" == cat ]]; then exit 1; fi
echo "$*" >> "{root}/systemctl-calls"; exit 0''',
   'systemd-run':'''[[ "$*" == *--property=DynamicUser=yes* && "$*" == *--probe-systemd-credential* ]] || exit 1
[[ "$SIM_MODE" != probe_fail ]]''',
   'systemd-analyze':f'''cp "$2" "{root}/captured.service"
cp "$3" "{root}/captured.timer"
exec "{real_analyze}" "$@"'''
  }
  for name,body in stubs.items():
   f=root/'bin'/name;f.write_text('#!/bin/bash\n'+body+'\n');f.chmod(0o755)
  env={**os.environ,'PATH':str(root/'bin')+':'+os.environ['PATH'],'SIM_MODE':mode}
  p=subprocess.run(['bash',str(root/'scripts/v3-volume-install.sh'),'--install'],
                   cwd=root,env=env,text=True,capture_output=True,timeout=30)
  calls=(root/'systemctl-calls').read_text() if (root/'systemctl-calls').exists() else ''
  if mode in ('ok','missing_optional'):
   assert p.returncode==0,p.stdout+p.stderr
   service=(root/'captured.service').read_text();timer=(root/'captured.timer').read_text()
   assert 'DynamicUser=yes' in service and 'volume-gas-key:' in service
   assert 'v3-hourly-volume-keeper-gas-only.key' in service
   assert 'globaldroptrade-v3-hourly-volume' in service
   assert 'OnCalendar=*:0/2' in timer
   assert 'enable --now' in calls and 'start --no-block' in calls
   assert 'private-test-fixture' not in p.stdout+p.stderr
  else:
   assert p.returncode!=0,(mode,p.stdout,p.stderr)
   assert not calls,(mode,calls)
   if mode=='symlink':assert unit.is_symlink()
   else:assert not unit.exists()

for case in ['ok','missing_optional','same','routed_same','original_same','routed_symlink','original_symlink',
             'insufficient','symlink','probe_fail']:
 exercise(case)
print('PASS isolated volume installer signer, gas, credential, unit and failure guards')

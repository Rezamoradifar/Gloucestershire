import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';

const path='ubuntu-testnet-zero-v2-deploy.sh';
const src=fs.readFileSync(path,'utf8');

test('zero V2 deployment wrapper has explicit modes and valid bash syntax',()=>{
 assert.equal(spawnSync('bash',['-n',path],{encoding:'utf8'}).status,0);
 assert.match(src,/--check\|--execute/);
 assert.match(src,/node scripts\/preflight-testnet-zero-v2\.mjs --check/);
 assert.match(src,/node scripts\/testnet-zero-v2-deploy\.mjs --plan/);
 assert.match(src,/node scripts\/testnet-zero-v2-deploy\.mjs --execute/);
 assert.match(src,/if \[ "\$mode" = --check \]; then/);
 assert.match(src,/ZERO_V2_WRAPPER_CHECK_PASS/);
});

test('execution waits for existing signer to finish and restores prior timer',()=>{
 assert.match(src,/systemctl stop "\$timer"/);
 assert.match(src,/systemctl disable "\$timer"/);
 assert.match(src,/current=\$\(systemctl show --property=ActiveState --value "\$service"\)/);
 assert.match(src,/ZERO_V2_OLD_SERVICE_BUSY/);
 assert.match(src,/timer_changed=1\nsystemctl stop/);
 assert.match(src,/restore_timer\(\)/);
 assert.match(src,/systemctl start "\$timer"/);
 assert.match(src,/systemctl enable "\$timer"/);
 assert.match(src,/trap cleanup EXIT/);
 assert.match(src,/trap 'exit 130' INT/);
 assert.match(src,/trap 'exit 143' TERM/);
 assert.match(src,/trap 'exit 129' HUP/);
});

test('execution does not erase V1 data, switch the site, or activate unreviewed V2 automation',()=>{
 assert.match(src,/ZERO_V2_DEPLOYMENT_FINISHED_V1_SITE_UNCHANGED/);
 assert.match(src,/globaldroptrade-new-deployer-daily\.service/);
 assert.match(src,/globaldroptrade-new-deployer-daily\.timer/);
 assert.doesNotMatch(src,/rm -rf|\.rmSync|delete|TRADES_VAULT_ADDRESS=/);
 assert.doesNotMatch(src,/ubuntu-connect|ubuntu-production-automation|ubuntu-enable-new-deployer/);
 assert.doesNotMatch(src,/--mainnet/);
});

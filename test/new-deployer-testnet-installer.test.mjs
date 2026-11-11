import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';

const file='ubuntu-connect-new-deployer-testnet.sh';
const source=fs.readFileSync(file,'utf8');

test('replacement-deployer installer parses and keeps the legacy cutover isolated',()=>{
    const result=spawnSync('bash',['-n',file],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    for(const required of ['scripts/connect-new-deployer-testnet.mjs','scripts/preflight-new-deployer-testnet.mjs','NEW_DEPLOYER_LEGACY_JOURNALS_SETTLED','legacy_locks=','NEW_DEPLOYER_LEGACY_WORKER_LOCKED'])assert.match(source,new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    for(const forbidden of ['ubuntu-connect-zero-start.sh','ubuntu-reset-fresh-testnet-20261107.sh','ubuntu-unified.sh'])assert.doesNotMatch(source,new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('busy signer workers fail before cutover and rollback never force-stops them',()=>{
    const wait=source.indexOf('NEW_DEPLOYER_WAITING_FOR_SIGNER_WORKER');
    const failure=source.indexOf('NEW_DEPLOYER_SIGNER_WORKER_BUSY_RETRY_SAME_COMMAND');
    const install=source.indexOf('install -m 600 "$stage/trades.env" "$envfile"');
    assert.ok(wait>=0&&failure>wait&&install>failure,'busy worker must fail before environment installation');
    assert.doesNotMatch(source,/while IFS='\|' read -r worker enabled active; do systemctl stop "\$worker"/);
    assert.match(source,/for timer in "\$\{timers\[@\]\}"; do[\s\S]{0,240}systemctl stop "\$timer"/);
});

test('systemd inspection failures cannot be treated as absent workers',()=>{
    assert.match(source,/info=\$\(unit_info "\$worker"\) \|\| exit 1/);
    assert.match(source,/info=\$\(unit_info "\$timer"\) \|\| exit 1/);
    assert.doesNotMatch(source,/systemctl show --property=LoadState --value "\$worker" 2>\/dev\/null \|\| true/);
});

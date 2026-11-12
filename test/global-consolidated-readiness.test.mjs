import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
const file='ubuntu-global-complete-readiness.sh',source=readFileSync(file,'utf8');
test('consolidated readiness script has valid Bash syntax and explicit nonfinancial modes',()=>{
 assert.equal(spawnSync('bash',['-n',file],{encoding:'utf8'}).status,0);
 assert.match(source,/--local\|--live-readonly/);
 assert.match(source,/GLOBAL_LIVE_READONLY_PASS/);
 assert.match(source,/GLOBAL_LOCAL_ACCEPTANCE_TEST_PASS/);
 assert.match(source,/GLOBAL_AUTOMATION_NO_BLOCKERS/);
 assert.match(source,/testnet-rpc-doctor.mjs/);
 assert.match(source,/testnet-withdrawal-audit.mjs/);
 assert.match(source,/preflight-testnet-zero-v2.mjs --check/);
});
test('the live acceptance gate cannot reset journals, rotate a signer or deploy V2',()=>{
 const live=source.slice(source.indexOf("echo 'GLOBAL_LIVE_READONLY_START'"));
 for(const forbidden of ['--execute','--install','--apply','eth_sendRawTransaction','setCustomerStatus(','new Wallet(','systemctl stop','systemctl restart','systemctl disable','rm -rf -- /var/lib/globaldroptrade']){
  assert.equal(live.includes(forbidden),false,forbidden);
 }
 assert.match(live,/systemctl is-active --quiet/);
 assert.match(live,/curl -fsS/);
 assert.match(live,/V2 deployment, cutover, mainnet transfers, manual credits and reindexing writes were NOT performed/);
});

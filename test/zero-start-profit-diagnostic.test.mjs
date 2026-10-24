import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {planDailyEpoch} from '../scripts/daily-profit.mjs';

const entry=fileURLToPath(new URL('../scripts/diagnose-zero-profit.mjs',import.meta.url));
test('read-only diagnosis validates arguments before opening private configuration or signer files',()=>{
 const result=spawnSync(process.execPath,[entry,'--invalid'],{encoding:'utf8',timeout:15000});
 assert.equal(result.status,1,result.stdout+result.stderr);
 const lines=result.stdout.trim().split('\n'),value=JSON.parse(lines.at(-1));
 assert.equal(value.transactionsSent,0);assert.equal(value.signerOpened,false);
 assert.equal(value.diagnostic.phase,'ARGUMENT_VALIDATION');
 assert.equal(value.blocker,'ROOT_DIAGNOSTIC_PROFILE_ONLY_REQUIRED');assert.equal(result.stderr,'');
});
test('diagnosis imports without running and the planning page budget rejects invalid bounds before RPC reads',async()=>{
 const source='await import('+JSON.stringify(new URL('../scripts/diagnose-zero-profit.mjs',import.meta.url).href)+');';
 const result=spawnSync(process.execPath,['--input-type=module','-'],{input:source,encoding:'utf8',timeout:15000});
 assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'');assert.equal(result.stderr,'');
 for(const limit of [0,101,1.5,NaN])await assert.rejects(planDailyEpoch({maxRegistryPages:limit}),/DAILY_MEMBER_INDEX_LIMIT_INVALID/);
});

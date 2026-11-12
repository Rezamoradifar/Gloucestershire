import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {scannerRefreshInstalled} from '../scripts/check-live-worker-index.mjs';
test('live worker identification requires the new indexed-target advancement in the actual payment scan',()=>{
 assert.equal(scannerRefreshInstalled('const scan=await scanPositionHistory({provider,advanceCompletedTarget:isNewDeployerTestnetPolicy(policy)});'),true);
 assert.equal(scannerRefreshInstalled('advanceCompletedTarget:isNewDeployerTestnetPolicy(policy)'),false);
 assert.equal(scannerRefreshInstalled('const scan=await scanPositionHistory({provider,parallelPositionEvents:isNewDeployerTestnetPolicy(policy)});'),false);
});
test('worker release check is read-only and never calls the signer or changes a journal',()=>{
 assert.equal(spawnSync(process.execPath,['--check','scripts/check-live-worker-index.mjs'],{encoding:'utf8'}).status,0);
 const contents=readFileSync('scripts/check-live-worker-index.mjs','utf8');
 assert.match(contents,/GLOBAL_WORKER_RELEASE_OUTSIDE_VETTED_ROOT/);
 assert.match(contents,/pendingFinancialTransactions/);
 assert.match(contents,/indexRefreshInLiveWorker/);
 for(const forbidden of ['new Wallet(','sendTransaction(','broadcastTransaction(','writeFileSync(','systemctl stop','systemctl restart','fs.rmSync('])
  assert.equal(contents.includes(forbidden),false,forbidden);
});

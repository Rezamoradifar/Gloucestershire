import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const script=fs.readFileSync('ubuntu-mainnet-final-gate.sh','utf8');
const doc=fs.readFileSync('MAINNET-FINAL-LAUNCH-20261111.md','utf8');

test('final mainnet gate is read-only and never installs or deploys',()=>{
 assert.match(script,/ubuntu-mainnet\.sh plan/);
 assert.match(script,/ubuntu-mainnet-readiness\.sh check/);
 assert.match(script,/ubuntu-production-automation\.sh --check/);
 assert.doesNotMatch(script,/ubuntu-production-automation\.sh --install/);
 assert.doesNotMatch(script,/ubuntu-mainnet\.sh deploy/);
 assert.match(script,/transactionsSent:0/);
});

test('final gate requires explicit simulation sender and keeps testnet separate',()=>{
 assert.match(script,/--from/);
 assert.match(doc,/chain ID `56`/);
 assert.match(doc,/chain-97 journals remain separate/);
 assert.match(doc,/dedicated reporter\/operator must not reuse the owner key/);
});

test('activation remains an explicit post-review action',()=>{
 assert.match(script,/MAINNET_DEPLOYMENT_AND_ACTIVATION_MANIFEST_REQUIRED/);
 assert.match(doc,/distinct explicit action/);
 assert.match(doc,/Do not proceed with real funds/);
});

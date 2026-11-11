import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';

const file='ubuntu-final-testnet-e2e.sh';
const source=fs.readFileSync(file,'utf8');

test('final testnet gate is syntax-valid and never broadcasts public-chain user transactions',()=>{
  assert.equal(spawnSync('bash',['-n',file],{encoding:'utf8'}).status,0);
  assert.match(source,/--local\|--live-readonly\|--all/);
  assert.match(source,/test\/new-deployer-testnet-automation\.test\.mjs/);
  assert.match(source,/test\/new-deployer-testnet-index-catchup\.test\.mjs/);
  assert.match(source,/test\/split-position-index\.test\.mjs/);
  assert.match(source,/FINAL_TESTNET_GATE_PASS/);
  assert.doesNotMatch(source,/--execute/);
  assert.doesNotMatch(source,/sendTransaction|eth_sendRawTransaction|eth_sendTransaction/);
});

test('live gate is pinned to chain 97 and the current replacement testnet target',()=>{
  assert.match(source,/expected_target="0x4C0F6141b18971db4b14e45c0bE8CddB09febc14"/);
  assert.match(source,/config\.get\('chainId'\) != 97/);
  assert.match(source,/status\.get\('chainId'\) != 97/);
  assert.match(source,/FINAL_TESTNET_CATCHUP_NOT_COMPLETE/);
  assert.match(source,/globaldroptrade-new-deployer-daily\.timer/);
});

test('live gate requires structured credit evidence when a latest credit is reported',()=>{
  assert.match(source,/lastCreditPresent/);
  assert.match(source,/transactionHash/);
  assert.match(source,/FINAL_TESTNET_LAST_CREDIT_INVALID/);
});

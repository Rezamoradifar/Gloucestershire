import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {getAddress,keccak256,toUtf8Bytes} from 'ethers';
import {latestUserPositions,periodTimes,personalBatchId,expectedVault} from '../scripts/diagnose-new-user-testnet.mjs';

const memberA=getAddress('0x1111111111111111111111111111111111111111');
const memberB=getAddress('0x2222222222222222222222222222222222222222');
const asset=getAddress('0x3333333333333333333333333333333333333333');

test('latest user diagnostic selects unique wallets with newer positions first',()=>{
 const values={
  [memberA.toLowerCase()+':0']:{member:memberA,id:'0',openedAt:1000},
  [memberA.toLowerCase()+':1']:{member:memberA,id:'1',openedAt:3000},
  [memberB.toLowerCase()+':0']:{member:memberB,id:'0',openedAt:2000}
 };
 const chosen=latestUserPositions(values,2);
 assert.deepEqual(chosen.map(x=>x.row.member),[memberA,memberB]);
 assert.deepEqual(chosen.map(x=>x.row.id),['1','0']);
 assert.throws(()=>latestUserPositions(values,21),/LIMIT|POSITIONS_REQUIRED/);
 assert.throws(()=>latestUserPositions({'tampered:0':{member:memberA,id:'0',openedAt:1000}}),/IDENTITY_CHANGED/);
});

test('the zero-indexed position-hour batch id reproduces the exact payment domain',()=>{
 const id=personalBatchId({chainId:97,vault:expectedVault,member:memberA,positionId:'0',period:1,asset});
 const domain=['GLOBAL_POSITION_HOURLY_NEW_DEPLOYER_TEST_V1','97',expectedVault.toLowerCase(),memberA.toLowerCase(),'0','1',asset.toLowerCase()].join(':');
 assert.equal(id,keccak256(toUtf8Bytes(domain+':personal')));
 assert.throws(()=>personalBatchId({chainId:56,vault:expectedVault,member:memberA,positionId:'0',period:1,asset}),/PERIOD_INVALID/);
});

test('periods are one full hour from each positions own open timestamp',()=>{
 assert.deepEqual(periodTimes(1_700_000_000,0),{start:1_700_000_000,end:1_700_003_600});
 assert.deepEqual(periodTimes(1_700_000_000,2),{start:1_700_007_200,end:1_700_010_800});
});

test('diagnosis has no signer, journal write, status publication or financial send',()=>{
 const source=fs.readFileSync('scripts/diagnose-new-user-testnet.mjs','utf8');
 assert.equal(spawnSync(process.execPath,['--check','scripts/diagnose-new-user-testnet.mjs'],{encoding:'utf8'}).status,0);
 for(const token of ['signTransaction','Wallet(','broadcastTransaction','sendTransaction','writePrivateJson','writeFileSync','eth_sendRawTransaction'])assert.equal(source.includes(token),false,token);
 assert.match(source,/createDailyActivityReader/);
 assert.match(source,/usedRewardBatch/);
 assert.match(source,/expectedPersonal/);
 assert.match(source,/transactionsSent:0/);
});


test('quarter cutover diagnostic uses the exact 900-second position anniversary and distinct personal batch domain',()=>{
 const cutover='0x'+'ab'.repeat(32);
 assert.deepEqual(periodTimes(1_700_000_000,0,{periodSeconds:900,cutoverTimestamp:1_700_002_000}),
  {start:1_700_002_000,end:1_700_002_900});
 assert.deepEqual(periodTimes(1_700_003_000,2,{periodSeconds:900,cutoverTimestamp:1_700_002_000}),
  {start:1_700_004_800,end:1_700_005_700});
 const q=personalBatchId({chainId:97,vault:expectedVault,member:memberA,positionId:'0',period:1,asset,quarterCutoverHash:cutover});
 const domain=['GLOBAL_POSITION_QUARTER_NEW_DEPLOYER_TEST_V1',cutover,'97',expectedVault.toLowerCase(),memberA.toLowerCase(),'0','1',asset.toLowerCase()].join(':');
 assert.equal(q,keccak256(toUtf8Bytes(domain+':personal')));
 const h=personalBatchId({chainId:97,vault:expectedVault,member:memberA,positionId:'0',period:1,asset});
 assert.notEqual(q,h);
 assert.throws(()=>periodTimes(1_700_000_000,1,{periodSeconds:900}),/PERIOD_INVALID/);
});

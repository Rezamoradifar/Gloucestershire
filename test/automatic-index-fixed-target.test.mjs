import assert from 'node:assert/strict';
import {test} from 'node:test';
import {getAddress,keccak256,toUtf8Bytes} from 'ethers';
import {newDeployerTestnetPolicyFields,validateDailyPolicy} from '../scripts/daily-profit.mjs';
import {catchUpNewDeployerIndex} from '../scripts/index-new-deployer-catchup.mjs';
import {pendingFixedTarget} from '../scripts/auto-index-new-deployer.mjs';

const h=value=>keccak256(toUtf8Bytes(String(value)));
const block=number=>({number,hash:h('block-'+number),timestamp:1700000000+number});
const vault=getAddress('0x3333333333333333333333333333333333333333');
const owner=getAddress('0x1111111111111111111111111111111111111111');
const operator=getAddress('0x2222222222222222222222222222222222222222');
const policy=validateDailyPolicy({version:1,chainId:97,vaultAddress:vault,runtimeHash:h('runtime'),deploymentBlock:1000,startTimestamp:1700001000,basis:'position-anniversary-principal',positionScheduleVersion:1,periodSeconds:3600,includeReinvestment:true,owner,operator,...newDeployerTestnetPolicyFields});
const provider={getBlockNumber:async()=>5000,getBlock:async number=>block(number),getLogs:async()=>[]};

test('automatic work scans only the existing fixed target even when the chain has advanced',async()=>{
 const state={transactions:{},daily:{epoch:19,positionPaid:{alice:3},positionClosed:{},positionScanTarget:{number:1999,hash:block(1999).hash}}};
 const finance=JSON.stringify({transactions:state.transactions,epoch:state.daily.epoch,paid:state.daily.positionPaid});
 assert.equal(pendingFixedTarget(state),true);
 const result=await catchUpNewDeployerIndex({provider,policy,state,save:()=>{},fixedTargetOnly:true});
 assert.equal(result.status,'indexed');assert.equal(result.indexThrough,1999);assert.equal(result.memberThrough,1999);
 assert.equal(result.indexTarget,1999);assert.deepEqual(state.daily.positionScanTarget,{number:1999,hash:block(1999).hash});
 assert.equal(pendingFixedTarget(state),false);
 assert.equal(JSON.stringify({transactions:state.transactions,epoch:state.daily.epoch,paid:state.daily.positionPaid}),finance);
 assert.equal(result.signerOpened,false);assert.equal(result.transactionsSent,0);
});

test('missing or already completed target never triggers automatic work',()=>{
 assert.equal(pendingFixedTarget({daily:{}}),false);
 const target={number:1000,hash:block(1000).hash};
 assert.equal(pendingFixedTarget({daily:{positionScanTarget:target,registry:{through:1000},positionIndex:{through:1000}}}),false);
 assert.throws(()=>pendingFixedTarget({daily:{positionScanTarget:target,registry:{through:1001}}}),/INDEX_AUTO_PREFIX_INVALID/);
});

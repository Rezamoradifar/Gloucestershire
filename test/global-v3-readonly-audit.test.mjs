import test from 'node:test';
import assert from 'node:assert/strict';
import {keccak256} from 'ethers';
import {auditV3Snapshot,auditV3Values} from '../scripts/audit-global-v3-readonly.mjs';

const record=(override={})=>({
 cash:1000n,principal:900n,profit:100n,escrow:10n,
 principalEscrow:5n,shortfall:0n,...override
});
test('read-only V3 financial audit detects reconciled funded and unfunded accounting',()=>{
 assert.equal(auditV3Values(record()).fullyCovered,true);
 const short=auditV3Values(record({cash:950n,shortfall:50n}));
 assert.equal(short.fullyCovered,false);
 assert.equal(short.shortfallTestUnits,'50');
 assert.equal(short.totalLiabilityTestUnits,'1000');
});
test('refuses broken escrow invariants or fabricated cash/liability reconciliation',()=>{
 assert.throws(()=>auditV3Values(record({cash:950n,shortfall:0n})));
 assert.throws(()=>auditV3Values(record({cash:5n,shortfall:995n})));
 assert.throws(()=>auditV3Values(record({escrow:11n,principalEscrow:12n})));
 assert.throws(()=>auditV3Values(record({escrow:-1n})));
 assert.throws(()=>auditV3Values(record({principal:0n,principalEscrow:1n})));
});

const vault='0x1111111111111111111111111111111111111111';
const token='0x2222222222222222222222222222222222222222';
const beneficiary='0x3333333333333333333333333333333333333333';
const blockHash='0x'+'ab'.repeat(32),code='0x6001',runtimeHash=keccak256(code);

function fixture({reorg=false,chain='0x61',returnedCode=code}={}){
 let blockReads=0;const tags=[];
 const provider={
  async send(method){assert.equal(method,'eth_chainId');return chain;},
  async getBlockNumber(){return 105;},
  async getBlock(number){assert.equal(number,103);return {number,hash:reorg&&++blockReads>1?'0x'+'cd'.repeat(32):blockHash};},
  async getCode(address,number){assert.equal(address,vault);tags.push(number);return returnedCode;}
 };
 const check=at=>{assert.deepEqual(at,{blockTag:103});tags.push(at.blockTag);};
 const contracts={
  [vault]:{
   async asset(at){check(at);return token;},
   async cashStatus(at){check(at);return {cash:1000n,principal:900n,accruedProfit:100n,escrowedCash:10n,totalCashShortfall:0n};},
   async withdrawalCount(at){check(at);return 1n;},
   async principalEscrowed(at){check(at);return 5n;},
   async withdrawalOf(id,at){assert.equal(id,0);check(at);return {beneficiary,kind:0n,status:2n,gross:10n,fee:1n};}
  },
  [token]:{
   async balanceOf(address,at){assert.equal(address,vault);check(at);return 1000n;},
   async decimals(at){check(at);return 18n;}
  }
 };
 return {provider,tags,makeContract(address){assert.ok(contracts[address]);return contracts[address];}};
}

test('every ledger and request read uses one confirmed block',async()=>{
 const f=fixture();
 const result=await auditV3Snapshot(f.provider,vault,runtimeHash,{makeContract:f.makeContract});
 assert.deepEqual(result.checkpoint,{block:103,blockHash,observedHead:105,confirmations:3});
 assert.equal(result.fullyCovered,true);
 assert.equal(result.withdrawalCount,1);
 assert.equal(result.latest20Only[0].beneficiary,beneficiary);
 assert.equal(f.tags.length,8);
 assert.ok(f.tags.every(tag=>tag===103));
});

test('refuses a changed confirmed block, wrong chain or unexpected runtime',async()=>{
 for(const [options,message] of [[{reorg:true},/V3_CONFIRMED_BLOCK_CHANGED/],
  [{chain:'0x38'},/V3_TESTNET_CHAIN_REQUIRED/],[{returnedCode:'0x6002'},/V3_RUNTIME_HASH_MISMATCH/]]){
  const f=fixture(options);
  await assert.rejects(auditV3Snapshot(f.provider,vault,runtimeHash,{makeContract:f.makeContract}),message);
 }
});

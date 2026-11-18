import assert from 'node:assert/strict';
import test from 'node:test';
import {getAddress,keccak256,ZeroAddress} from 'ethers';
import {validateUnifiedProof,verifyUnifiedDeployment} from '../scripts/verify-v3-unified-deployment.mjs';
import {checkUnifiedKeeper} from '../scripts/check-v3-unified-keeper.mjs';
import {simulateUnifiedAccrual} from '../scripts/simulate-v3-unified-keeper.mjs';

const A=n=>getAddress('0x'+n.toString(16).padStart(40,'0'));
const H=n=>'0x'+n.toString(16).padStart(64,'0');
const TOKEN=getAddress('0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89');
const FEE1=getAddress('0x7037cc199499d7a3431285a01e435454eae51265');
const FEE2=getAddress('0x5bc282a45a8a1d7d9b915f04fc1d4031156d7632');
const OPERATIONS=getAddress('0x8c4ac9b009808a0b49ba77b58e3871e7cdba463c');

function fixture(){
 const state={chain:'0x61',blockHash:H(99),deploymentHash:H(77),receiptBlockHash:H(77),deploymentChanged:false,bookVault:A(1),roleAllowed:true,changed:false,reorgDuringScan:false,
  privileged:false,eligible:true,paused:false,gas:600000n,price:1000000000n,balance:10n**18n,simulationFails:false};
 const vaultCode='0x6001',bookCode='0x6002',networkCode='0x6003';
 const proof={status:'VERIFIED_UNIFIED_TESTNET_ONLY',chainId:97,vault:A(1),book:A(2),network:A(3),
  token:TOKEN,manager:A(4),feeReceiver:A(5),deploymentBlock:100,deploymentTx:H(15),
  vaultRuntimeHash:keccak256(vaultCode),bookRuntimeHash:keccak256(bookCode),networkRuntimeHash:keccak256(networkCode)};
 const calls=[];let blocks=0,deploymentBlocks=0;
 const at=o=>{assert.deepEqual(o,{blockTag:118});};
 const parent={
  asset:async o=>{at(o);return TOKEN;},feeReceiver:async o=>{at(o);return A(5);},
  reinvestmentBook:async o=>{at(o);return A(2);},networkPlan:async o=>{at(o);return A(3);},
  ACCRUAL_PERIOD:async o=>{at(o);return 3600n;},ONE_DAY:async o=>{at(o);return 86400n;},
  FEE_WALLET_1:async o=>{at(o);return FEE1;},FEE_WALLET_2:async o=>{at(o);return FEE2;},
  OPERATIONS_WALLET:async o=>{at(o);return OPERATIONS;},DEPOSIT_FEE_EACH_BPS:async o=>{at(o);return 1000n;},
  paused:async o=>{if(o)at(o);return state.paused;},memberCount:async o=>{at(o);if(state.reorgDuringScan)state.changed=true;return 0n;},
  isEligible:async()=>state.eligible,reinvestmentPositionPlusOne:async()=>1n,
  DEFAULT_ADMIN_ROLE:async()=>H(6),MANAGER_ROLE:async o=>{if(o)at(o);return H(7);},
  FUNDER_ROLE:async()=>H(8),GUARDIAN_ROLE:async()=>H(9),hasRole:async(role,manager,o)=>{
   if(o){at(o);assert.equal(role,H(7));assert.equal(manager,A(4));return state.roleAllowed;}
   return state.privileged;
  },
  getFunction:()=>({staticCall:async()=>{if(state.simulationFails)throw Error('revert');},estimateGas:async()=>state.gas})
 };
 const provider={
  send:async(name,args)=>{
   if(name==='eth_chainId'){assert.deepEqual(args,[]);return state.chain;}
   assert.equal(name,'eth_getBlockByNumber');
   if(args[0]==='0x64'){
    assert.equal(args[1],false);deploymentBlocks++;
    return {number:'0x64',hash:state.deploymentChanged&&deploymentBlocks>1?H(78):state.deploymentHash,timestamp:'0x300'};
   }
   assert.deepEqual(args,['0x76',false]);blocks++;
   return {number:'0x76',hash:state.changed&&blocks>1?H(100):state.blockHash,timestamp:'0x3e8'};
  },
  getBlockNumber:async()=>120,
  getBlock:async name=>{assert.equal(name,'latest');return {gasLimit:30000000n};},
  getFeeData:async()=>({gasPrice:state.price}),getBalance:async()=>state.balance,
  getTransactionReceipt:async h=>{assert.equal(h,H(15));return {status:1,contractAddress:A(1),blockNumber:100,blockHash:state.receiptBlockHash,hash:H(15)};},
  getCode:async(a,n)=>{assert.equal(n,118);calls.push(a);return ({[A(1)]:vaultCode,[A(2)]:bookCode,[A(3)]:networkCode,[TOKEN]:'0x60'})[a]||'0x';}
 };
 const makeContract=(a)=>a===A(1)?parent:{vault:async o=>{at(o);return a===A(2)?state.bookVault:A(1);}};
 return {state,proof,provider,makeContract,calls};
}

test('checks the pinned parent, both linked components and deployment at one confirmed block',async()=>{
 const f=fixture();
 const verified=await verifyUnifiedDeployment(f.provider,f.proof,{makeContract:f.makeContract});
 assert.equal(verified.block.number,118);assert.equal(verified.block.hash,H(99));
 assert.equal(verified.transactionSent,false);assert.equal(verified.siteUpdated,false);
 assert.deepEqual(new Set(f.calls),new Set([A(1),A(2),A(3),TOKEN]));
});

test('rejects missing, unpinned, mainnet or mismatched components',async()=>{
 const f=fixture();
 assert.throws(()=>validateUnifiedProof({...f.proof,token:ZeroAddress}),/DEPLOYMENT_PROOF/);
 assert.throws(()=>validateUnifiedProof({...f.proof,book:A(1)}),/DEPLOYMENT_PROOF/);
 assert.throws(()=>validateUnifiedProof({...f.proof,networkRuntimeHash:'0x01'}),/DEPLOYMENT_PROOF/);
 f.state.chain='0x38';
 await assert.rejects(verifyUnifiedDeployment(f.provider,f.proof,{makeContract:f.makeContract}),/TESTNET_CHAIN/);
 f.state.chain='0x61';
 await assert.rejects(verifyUnifiedDeployment(f.provider,{...f.proof,bookRuntimeHash:H(1)},{makeContract:f.makeContract}),/RUNTIME_MISMATCH/);
 f.state.bookVault=A(4);
 await assert.rejects(verifyUnifiedDeployment(f.provider,f.proof,{makeContract:f.makeContract}),/CONFIGURATION_MISMATCH/);
});

test('rejects an unauthorized manager and a changed confirmed block',async()=>{
 let f=fixture();f.state.roleAllowed=false;
 await assert.rejects(verifyUnifiedDeployment(f.provider,f.proof,{makeContract:f.makeContract}),/CONFIGURATION_MISMATCH/);
 f=fixture();f.state.changed=true;
 await assert.rejects(verifyUnifiedDeployment(f.provider,f.proof,{makeContract:f.makeContract}),/BLOCK_CHANGED/);
});

test('rejects a noncanonical deployment receipt or deployment-block reorganization',async()=>{
 let f=fixture();f.state.receiptBlockHash=H(78);
 await assert.rejects(verifyUnifiedDeployment(f.provider,f.proof,{makeContract:f.makeContract}),/DEPLOYMENT_RECEIPT_MISMATCH/);
 f=fixture();f.state.deploymentChanged=true;
 await assert.rejects(verifyUnifiedDeployment(f.provider,f.proof,{makeContract:f.makeContract}),/BLOCK_CHANGED/);
});

test('verified keeper preflight rechecks the original block after scanning',async()=>{
 const cursor={member:0,position:0,lot:0};
 let f=fixture();
 const result=await checkUnifiedKeeper({provider:f.provider,proof:f.proof,makeContract:f.makeContract,cursor});
 assert.equal(result.chainId,97);assert.equal(result.plan.members,0);
 assert.equal(result.transactionSent,false);assert.equal(result.siteUpdated,false);
 f=fixture();f.state.reorgDuringScan=true;
 await assert.rejects(checkUnifiedKeeper({provider:f.provider,proof:f.proof,makeContract:f.makeContract,cursor}),/BLOCK_CHANGED/);
});

test('dry-runs only bounded pages from a funded, unprivileged keeper',async()=>{
 const f=fixture();const member=A(6),operator=A(7);
 const candidate={member,positionId:0,method:'accrueReinvestmentPage',args:[member,0,8]};
 const simulate=()=>simulateUnifiedAccrual({provider:f.provider,proof:f.proof,makeContract:f.makeContract,candidate,operator});
 const result=await simulate();
 assert.equal(result.transactionSent,false);assert.equal(result.gasLimit,750000n);
 f.state.privileged=true;await assert.rejects(simulate(),/UNPRIVILEGED/);f.state.privileged=false;
 f.state.gas=2000000n;await assert.rejects(simulate(),/GAS_LIMIT/);f.state.gas=600000n;
 f.state.balance=0n;await assert.rejects(simulate(),/BNB_TOO_LOW/);f.state.balance=10n**18n;
 f.state.simulationFails=true;await assert.rejects(simulate(),/SIMULATION_FAILED/);
 await assert.rejects(simulateUnifiedAccrual({provider:f.provider,proof:f.proof,makeContract:f.makeContract,
  candidate:{...candidate,args:[member,0,9]},operator}),/INVALID_UNIFIED_CANDIDATE/);
});

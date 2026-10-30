import {test} from 'node:test';import assert from 'node:assert/strict';
import {validateProductionActivation} from '../scripts/production-automation-cli.mjs';
import {verifyProductionJournalAnchor} from '../scripts/production-automation.mjs';
const h='0x'+'11'.repeat(32),a='0x'+'11'.repeat(20);
const manifest=()=>({version:1,chainId:56,role:'standby',deploymentTxHash:h,rpcFiles:['/etc/globaldroptrade/mainnet-rpc-url'],gasBudgetWei:'20000000000000000',operator:a,deployer:a,queueAddress:a,policy:{version:1,chainId:56,vaultAddress:a,runtimeHash:h,deploymentBlock:1,startTimestamp:1,basis:'period-start-active-principal',periodSeconds:86400,includeReinvestment:true}});
test('activation rejects testnet, hourly policy, missing explicit budget, duplicate endpoints and an unbound writer host',()=>{
 assert.equal(validateProductionActivation(manifest()).role,'standby');
 for(const patch of [{chainId:97},{gasBudgetWei:'0'},{gasBudgetWei:'100000000000000001'},{rpcFiles:['/a','/a']},{rpcFiles:['relative']},{role:'primary'}])assert.throws(()=>validateProductionActivation({...manifest(),...patch}));
 assert.throws(()=>validateProductionActivation({...manifest(),policy:{...manifest().policy,periodSeconds:3600}}));
 assert.equal(validateProductionActivation({...manifest(),role:'primary',executionMachineId:'a'.repeat(32)}).role,'primary');
});
test('canonical journal proof checks the latest commitment and rejects a replaced header or conflicting receipt',async()=>{
 const h2='0x'+'22'.repeat(32),calls=[];
 const state={transactions:{a:{block:1,blockHash:h},b:{block:2,blockHash:h2}}};
 assert.deepEqual(await verifyProductionJournalAnchor({getBlock:async n=>{calls.push(n);return {hash:h2};}},state),{block:2,hash:h2});
 assert.deepEqual(calls,[2]);
 await assert.rejects(verifyProductionJournalAnchor({getBlock:async()=>({hash:h})},state),/REORG/);
 await assert.rejects(verifyProductionJournalAnchor({}, {...state,confirmedCheckpoint:{block:2,hash:h}}),/REORG/);
});
test('creation verification refuses an owner signing operator and a successful non-creation receipt',async()=>{
 const fs=await import('node:fs');
 const {verifyProductionDeployment}=await import('../scripts/production-automation-cli.mjs');
 const config=JSON.parse(fs.readFileSync('config.mainnet.json')),artifact=JSON.parse(fs.readFileSync('artifacts/AutomaticGroupVault.json'));
 await assert.rejects(verifyProductionDeployment({provider:{},activation:{...manifest(),operator:config.initialOwner},config,artifact,state:{}}),/DEDICATED_OPERATOR/);
 const provider={send:async()=> '0x38',getTransaction:async()=>({hash:h,to:a,from:a,chainId:56n,value:0n,data:'0x',blockNumber:1}),getTransactionReceipt:async()=>({hash:h,status:1,to:a,from:a,blockNumber:1}),getBlockNumber:async()=>10};
 await assert.rejects(verifyProductionDeployment({provider,activation:manifest(),config,artifact,state:{}}),/CREATION_PROOF/);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bindMigrationTransaction,migrationFeeCommitted,migrationHasUnresolvedRequest,archiveConfirmedControl} from '../deployment-console/deferred-wallet-journal.js';

test('wallet recovery binds the exact sender, chain, nonce and zero value before identifying replacements',()=>{
 const record={from:'0x1111111111111111111111111111111111111111',nonce:7,to:null,data:'0x1234'};
 const transaction={...record,chainId:97n,value:0n};assert.equal(bindMigrationTransaction(record,transaction),true);
 assert.equal(bindMigrationTransaction(record,{...transaction,data:'0x'}),false);
 for(const change of [{chainId:56n},{nonce:8},{value:1n},{from:'0x2222222222222222222222222222222222222222'}])assert.throws(()=>bindMigrationTransaction(record,{...transaction,...change}),/IDENTITY_MISMATCH/);
 assert.throws(()=>bindMigrationTransaction(record,null),/IDENTITY_MISMATCH/);
});

test('uncertain submissions block retries and confirmed control repeats keep all paid fees',()=>{
 const state={records:{pause:{uncertain:true,maxFee:'100'}},history:[{actualFee:'5',maxFee:'50'}]};
 assert.equal(migrationHasUnresolvedRequest(state),true);assert.equal(migrationFeeCommitted(state),105n);
 assert.throws(()=>archiveConfirmedControl(state,'pause'),/REQUIRES_RECOVERY/);
 Object.assign(state.records.pause,{hash:'0x1234',uncertain:false,actualFee:'20'});
 assert.equal(migrationHasUnresolvedRequest(state),false);archiveConfirmedControl(state,'pause');assert.equal(migrationFeeCommitted(state),25n);assert.equal(state.history.length,2);assert.equal(state.records.pause,undefined);
});

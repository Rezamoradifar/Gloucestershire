import test from 'node:test';
import assert from 'node:assert/strict';
import {explorerRequest,explorerSourceStatus,submissionForm,submissionGuid,verifyCreation,submitOnce}
 from '../scripts/submit-v3-hourly-verification.mjs';
import {contractAddress,contractName,compilerVersion,constructorArguments}
 from '../scripts/prepare-v3-hourly-verification.mjs';

const key='private-test-key';
const makeTransport=(body,seen)=>async(url,options)=>{
 seen.push({url,options});return {ok:true,text:async()=>JSON.stringify(body)};
};

test('status query is pinned to official Etherscan V2 chain 97 and cannot leak provider text',async()=>{
 const seen=[];
 const result={status:'1',result:[{SourceCode:'',ContractName:'',CompilerVersion:''}]};
 const response=await explorerRequest(key,'getsourcecode',null,{address:contractAddress},makeTransport(result,seen));
 assert.equal(explorerSourceStatus(response),'UNVERIFIED');
 assert.equal(seen[0].url.origin,'https://api.etherscan.io');
 assert.equal(seen[0].url.pathname,'/v2/api');
 assert.equal(seen[0].url.searchParams.get('chainid'),'97');
 assert.equal(seen[0].url.searchParams.get('address'),contractAddress);
 assert.equal(seen[0].options.redirect,'error');
 await assert.rejects(explorerRequest(key,'getsourcecode',null,{},async()=>{throw Error('leaked '+key)}),error=>error.message==='EXPLORER_REQUEST_FAILED'&&!error.message.includes(key));
});

test('verified explorer source requires expected name and compiler, not a mere response',()=>{
 const row={SourceCode:'source',ContractName:'GlobalV3HourlyTestnet',CompilerVersion:compilerVersion};
 assert.equal(explorerSourceStatus({status:'1',result:[row]}),'VERIFIED');
 assert.throws(()=>explorerSourceStatus({status:'0',result:'invalid key'}),/UNAVAILABLE/);
 assert.throws(()=>explorerSourceStatus({status:'1',result:[{...row,ContractName:'Wrong'}]}),/IDENTITY_MISMATCH/);
 assert.throws(()=>explorerSourceStatus({status:'1',result:[{...row,CompilerVersion:'v0.8.29'}]}),/IDENTITY_MISMATCH/);
});

test('submission is explicitly configured for the pinned source and returns a pending GUID only',async()=>{
 const form=submissionForm({language:'Solidity',sources:{},settings:{}});
 assert.equal(form.contractaddress,contractAddress);
 assert.equal(form.contractname,contractName);
 assert.equal(form.codeformat,'solidity-standard-json-input');
 assert.equal(form.compilerversion,compilerVersion);
 assert.equal(form.constructorArguments,constructorArguments);
 assert.equal(form.optimizationUsed,'1');assert.equal(form.runs,'1');assert.equal(form.evmVersion,'shanghai');
 const seen=[];const guid='123456789012345678901234567890';
 const response=await explorerRequest(key,'verifysourcecode',form,{},makeTransport({status:'1',result:guid},seen));
 assert.equal(seen[0].options.method,'POST');
 assert.equal(seen[0].url.searchParams.get('chainid'),'97');
 assert.equal(submissionGuid(response),guid);
 assert.throws(()=>submissionGuid({status:'0',result:'unverified'}),/REJECTED_OR_UNKNOWN/);
});

test('submission transport errors are unknown and never expose secrets or invite retries',async()=>{
 await assert.rejects(explorerRequest(key,'verifysourcecode',{sourceCode:'test'},{},async()=>{throw Error('secret '+key)}),error=>
  error.message==='EXPLORER_SUBMISSION_OUTCOME_UNKNOWN'&&!error.message.includes(key));
 await assert.rejects(explorerRequest('bad\nkey','getsourcecode'),/INVALID_EXPLORER_API_KEY_FORMAT/);
});

test('a POST timeout is journaled as unknown and the second call never broadcasts',async()=>{
 let journal=null,calls=0;
 const read=()=>journal;
 const write=(record,create=false)=>{if(create&&journal)throw Error('EXISTS');journal={...record};};
 const request=async()=>{calls++;throw Error('timeout '+key);};
 const args={key,input:{},read,write,request};
 await assert.rejects(submitOnce(args),error=>error.message==='VERIFICATION_SUBMISSION_OUTCOME_UNKNOWN_CHECK_BEFORE_RETRY'&&!error.message.includes(key));
 assert.equal(journal.status,'UNKNOWN');
 await assert.rejects(submitOnce(args),/SUBMISSION_EXISTS/);
 assert.equal(calls,1);
});

test('a successful submission remains pending until source status verifies',async()=>{
 let journal=null;
 const guid='123456789012345678901234567890';
 const got=await submitOnce({key,input:{},read:()=>journal,write:r=>{journal={...r}},
  request:async()=>({status:'1',result:guid})});
 assert.equal(got,guid);assert.equal(journal.guid,guid);assert.equal(journal.status,'PENDING');
});

test('creation verification rejects a different chain or contract before source submission',async()=>{
 const hash='0x'+'1'.repeat(64);
 const proof={txHash:hash};
 const provider={send:async()=> '0x38',getTransaction:async()=>({hash,to:null,data:'0x'+constructorArguments}),
  getTransactionReceipt:async()=>({hash,status:1,contractAddress})};
 await assert.rejects(verifyCreation(proof,provider),/CREATION_TRANSACTION_MISMATCH/);
 const wrong={...provider,send:async()=> '0x61',getTransactionReceipt:async()=>({hash,status:1,contractAddress:'0x0000000000000000000000000000000000000001'})};
 await assert.rejects(verifyCreation(proof,wrong),/CREATION_TRANSACTION_MISMATCH/);
});

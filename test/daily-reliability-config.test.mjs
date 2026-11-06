import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEnv} from 'node:util';
import {renderReliabilityEnv,verifyActivityPolicy,reliabilityTarget,activityHistory,journalFeeBudget} from '../scripts/prepare-daily-reliability.mjs';

const policy={version:1,chainId:97,vaultAddress:reliabilityTarget,origin:'https://globaldroptrade.com',windowSeconds:86400,activationTimestamp:2000000000,historyFile:activityHistory};
test('release env preserves multiline secrets and unrelated settings while binding activity metadata',()=>{
 const original='TRADES_CHAIN_ID=97\nTRADES_VAULT_ADDRESS='+reliabilityTarget+'\nTRADES_RPC_URL="https://original.invalid/key"\nMULTILINE="first\nTRADES_RPC_URL=inside-secret\nlast"\nCUSTOM=preserve\n';
 const next=renderReliabilityEnv(original,['https://first.invalid/private-key','https://second.invalid/other-key'],policy);
 const before=parseEnv(original),after=parseEnv(next);
 assert.equal(after.MULTILINE,before.MULTILINE);
 assert.equal(after.CUSTOM,'preserve');
 assert.equal(after.TRADES_CHAIN_ID,'97');
 assert.equal(after.TRADES_VAULT_ADDRESS,reliabilityTarget);
 assert.equal(after.TRADES_RPC_URL,'https://first.invalid/private-key');
 assert.deepEqual(JSON.parse(after.TRADES_RPC_URLS),['https://second.invalid/other-key']);
 assert.equal(after.DAILY_ACTIVITY_ACTIVATION_TIMESTAMP,'2000000000');
 assert.equal(after.DAILY_ACTIVITY_FILE,activityHistory);
 assert.ok(next.startsWith(original));
});
test('activity policy rejects another network, contract, window or history target',()=>{
 for(const delta of [{chainId:56},{vaultAddress:'0x'+'12'.repeat(20)},{windowSeconds:3600},{historyFile:'/tmp/other.json'},{origin:'https://other.invalid'},{activationTimestamp:0}])assert.throws(()=>verifyActivityPolicy({...policy,...delta}),/POLICY_MISMATCH/);
 assert.equal(verifyActivityPolicy(policy),policy);
});
test('RPC candidates cannot inject dotenv assignments or reset an existing cutoff',()=>{
 const original='CUSTOM=keep\n';
 for(const urls of [[],['https://host.invalid/key\nEVIL=1'],["https://host.invalid/key'\nEVIL=1"],['file:///etc/passwd'],['https://x.invalid','https://x.invalid'],Array.from({length:5},(_,i)=>'https://host'+i+'.invalid')])assert.throws(()=>renderReliabilityEnv(original,urls,policy));
 const next=renderReliabilityEnv(original,['https://host.invalid/key'],{...policy,activationTimestamp:1500000000});
 assert.equal(parseEnv(next).DAILY_ACTIVITY_ACTIVATION_TIMESTAMP,'1500000000');
});

const journalIdentity={version:1,chainId:97,target:reliabilityTarget,operator:'0x'+'12'.repeat(20),runtimeHash:'0x'+'34'.repeat(32)};
const journalEntry=(maxFee,confirmed=false)=>({raw:'0x1234',hash:'0x'+'56'.repeat(32),maxFee,...(confirmed?{block:3,blockHash:'0x'+'78'.repeat(32)}:{})});
test('cumulative confirmed and pending fee reservations remain within the unchanged budget',()=>{
 const state={identity:journalIdentity,transactions:{confirmed:journalEntry('90000000000000000',true),pending:journalEntry('10000000000000000')}};
 const before=JSON.stringify(state),report=journalFeeBudget(state,journalIdentity,0n);
 assert.deepEqual(report,{feeBudgetLimitWei:'100000000000000000',maxFeesReservedWei:'100000000000000000',feeBudgetRemainingWei:'0',operatorBalanceWei:'0',pendingSignedCount:1,waitingFor:['TOTAL_TEST_BNB_FEE_LIMIT_0_1','INSUFFICIENT_TEST_BNB']});
 assert.equal(JSON.stringify(state),before);
 assert.ok(!JSON.stringify(report).includes('0x1234'));
});
test('positive gas balance never hides a depleted reservation cap or resets confirmed fees',()=>{
 const state={identity:journalIdentity,transactions:{confirmed:journalEntry('100000000000000001',true)}};
 assert.deepEqual(journalFeeBudget(state,journalIdentity,10n).waitingFor,['TOTAL_TEST_BNB_FEE_LIMIT_0_1']);
 assert.equal(journalFeeBudget(state,journalIdentity,10n).feeBudgetRemainingWei,'0');
 state.transactions.confirmed.maxFee='17';
 assert.equal(journalFeeBudget(state,journalIdentity,10n).feeBudgetRemainingWei,'99999999999999983');
 assert.equal(journalFeeBudget(state,journalIdentity,10n).pendingSignedCount,0);
});
test('fee summary rejects malformed or cross-target journals without accepting negative reservations',()=>{
 const valid={identity:journalIdentity,transactions:{saved:journalEntry('17')}};
 for(const state of [{}, {...valid,transactions:[]}, {...valid,identity:{...journalIdentity,chainId:56}}, {...valid,identity:null}, {...valid,transactions:{saved:journalEntry('-1')}}, {...valid,transactions:{saved:{...journalEntry('17'),block:0}}}])assert.throws(()=>journalFeeBudget(state,journalIdentity,1n));
 assert.throws(()=>journalFeeBudget(valid,journalIdentity,-1n),/BALANCE_REQUIRED/);
 assert.deepEqual(journalFeeBudget({transactions:{}},journalIdentity,1n).waitingFor,[]);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {evaluateAutoActivity} from '../scripts/auto-activity-eligibility.mjs';
import {validateAutoActivityPolicy} from '../scripts/auto-activity-testnet.mjs';

const vault='0x4C0F6141b18971db4b14E45c0bE8cDdB09febc14';
const wallet='0x1111111111111111111111111111111111111111';
const time=1_800_000_000;
const eligible={chainId:97,vaultAddress:vault,wallet,confirmedBlock:12345,
 confirmedTimestamp:time,nowTimestamp:time+20,registered:true,active:false,
 vipKyc:false,capitalUsd:1000n*10n**18n,validSignedCheckIn:true,
 checkInTimestamp:time-1800,minimumCapitalUsd:10n**18n,eligibleSince:time-86400};

test('signed active registered users qualify for activation with unchanged KYC',()=>{
 const x=evaluateAutoActivity(eligible);
 assert.equal(x.action,'activate_without_kyc_change');
 assert.equal(x.observedKyc,false);
 assert.equal(x.requiresHumanKycReview,true);
 assert.deepEqual(x.blockers,[]);
 assert.equal(evaluateAutoActivity({...eligible,vipKyc:true}).observedKyc,true);
 assert.equal(evaluateAutoActivity({...eligible,active:true}).action,'already_active');
});

test('registered user alone cannot bypass verified deposit or signed 24-hour check-in',()=>{
 const cases=[
  [{registered:false},'WALLET_NOT_REGISTERED'],
  [{capitalUsd:0n},'MINIMUM_CAPITAL_NOT_MET'],
  [{validSignedCheckIn:false,checkInTimestamp:null},'SIGNED_24H_CHECKIN_REQUIRED'],
  [{checkInTimestamp:time-86400},'SIGNED_24H_CHECKIN_EXPIRED'],
  [{checkInTimestamp:time-90000},'SIGNED_24H_CHECKIN_EXPIRED'],
  [{checkInTimestamp:time+120},'SIGNED_24H_CHECKIN_EXPIRED'],
  [{nowTimestamp:time+3600},'CHAIN_SNAPSHOT_STALE'],
  [{checkInTimestamp:time-3600,eligibleSince:time-1200},'SIGNED_24H_CHECKIN_EXPIRED'],
 ];
 for(const [change,reason] of cases){
  const x=evaluateAutoActivity({...eligible,...change});
  assert.equal(x.action,'none');
  assert.ok(x.blockers.includes(reason),reason);
 }
});

test('refuses unverified or non-testnet identity, malformed data and negative policy',()=>{
 for(const change of [{chainId:56},{wallet:'invalid'},{vaultAddress:'bad'},
  {confirmedBlock:NaN},{capitalUsd:'100'},{validSignedCheckIn:'yes'},
  {minimumCapitalUsd:-1n},{nowTimestamp:-1}]){
  assert.throws(()=>evaluateAutoActivity({...eligible,...change}),/AUTO_ACTIVITY_UNVERIFIED_INPUT/);
 }
});

test('policy must be explicitly enabled, testnet-only and use dedicated root reporter key',()=>{
 const p={version:1,chainId:97,enabled:true,vaultAddress:vault,
  runtimeHash:'0x'+'a'.repeat(64),origin:'https://globaldroptrade.com',
  historyFile:'/var/lib/globaldroptrade-api/daily-activity.json',
  reporterKeyFile:'/etc/globaldroptrade/auto-activity/limited-reporter.key',
  maxActivations:3,activationTimestamp:time};
 assert.equal(validateAutoActivityPolicy(p).maxActivations,3);
 for(const change of [{chainId:56},{enabled:false},{reporterKeyFile:'/etc/globaldroptrade/new-deployer-testnet-v1/deployer.key'},
  {maxActivations:100},{origin:'https://evil.example'},{runtimeHash:'invalid'},{activationTimestamp:0}]){
  assert.throws(()=>validateAutoActivityPolicy({...p,...change}),/AUTO_ACTIVITY_POLICY_INVALID/);
 }
});

test('no financial actions or KYC changes are orchestrated by the activation worker',()=>{
 const code=fs.readFileSync(new URL('../scripts/auto-activity-testnet.mjs',import.meta.url),'utf8');
 assert.match(code,/setCustomerStatus\.populateTransaction\(item\.wallet,true,Boolean\(profile\.vipKyc\)\)/);
 assert.match(code,/reporters\(signer\.address\)/);
 assert.match(code,/readDailyActivity/);
 assert.match(code,/AUTO_ACTIVITY_GAS_CAP_EXCEEDED/);
 assert.doesNotMatch(code,/\.batchProfit\(|\.approveAndPay\(|\.withdrawPrincipal\(|\.setReporter\(/);
});

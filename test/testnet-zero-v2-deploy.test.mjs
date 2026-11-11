import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {loadNewDeployerRelease} from '../scripts/new-deployer-testnet-profile.mjs';
import {oldWriterQuiescent,validateV2Profile,validateV2Report} from '../scripts/testnet-zero-v2-deploy.mjs';
import {PREVIOUS_TESTNET_VAULT} from '../scripts/preflight-testnet-zero-v2.mjs';

const file='scripts/testnet-zero-v2-deploy.mjs';
const source=fs.readFileSync(file,'utf8');
const config=JSON.parse(fs.readFileSync('config/testnet-zero-v2.json','utf8'));
const base=loadNewDeployerRelease();

test('V2 deployer requires explicit testnet-only profile distinct from V1 state',()=>{
 assert.equal(validateV2Profile(config,base),config);
 assert.equal(config.previousVault,PREVIOUS_TESTNET_VAULT);
 assert.equal(config.chainId,97);
 assert.equal(config.migrateAccounts,false);
 assert.throws(()=>validateV2Profile({...config,chainId:56},base),/ZERO_V2_RELEASE_PROFILE_REQUIRED/);
 assert.throws(()=>validateV2Profile({...config,deployer:config.owner},base),/ZERO_V2_RELEASE_PROFILE_REQUIRED/);
 assert.throws(()=>validateV2Profile({...config,previousVault:config.owner},base),/ZERO_V2_RELEASE_PROFILE_REQUIRED/);
 assert.throws(()=>validateV2Profile({...config,artifactHash:'0x'+'00'.repeat(32)},base),/ZERO_V2_RELEASE_PROFILE_REQUIRED/);
});

test('V2 deployer refuses an already used contract and unverified genesis',()=>{
 const valid={chainId:97,verified:true,emptyAtDeployment:true,accountsMigrated:false,contractAddress:'0x1111111111111111111111111111111111111111'};
 assert.equal(validateV2Report(valid),valid);
 assert.throws(()=>validateV2Report({...valid,contractAddress:PREVIOUS_TESTNET_VAULT}),/ZERO_V2_EMPTY_DEPLOYMENT_REQUIRED/);
 assert.throws(()=>validateV2Report({...valid,chainId:56}),/ZERO_V2_EMPTY_DEPLOYMENT_REQUIRED/);
 assert.throws(()=>validateV2Report({...valid,emptyAtDeployment:false}),/ZERO_V2_EMPTY_DEPLOYMENT_REQUIRED/);
 assert.throws(()=>validateV2Report({...valid,accountsMigrated:true}),/ZERO_V2_EMPTY_DEPLOYMENT_REQUIRED/);
});

test('V2 requires a stopped old writer and disabled timer',()=>{
 const disabled=(_unit,property)=>property==='LoadState'?'loaded':property==='ActiveState'?'inactive':'disabled';
 assert.equal(oldWriterQuiescent(disabled),true);
 assert.equal(oldWriterQuiescent((unit,property)=>unit.endsWith('.timer')&&property==='UnitFileState'?'enabled':disabled(unit,property)),false);
 assert.equal(oldWriterQuiescent((unit,property)=>unit.endsWith('.service')&&property==='ActiveState'?'active':disabled(unit,property)),false);
 assert.throws(()=>oldWriterQuiescent(()=>{throw Error('cannot inspect');}),/cannot inspect/);
});

test('deployment CLI is syntax-valid with separate V2 journal, no V1 mutation or automatic cutover',()=>{
 assert.equal(spawnSync(process.execPath,['--check',file],{encoding:'utf8'}).status,0);
 assert.match(source,/!\['--plan','--execute'\]\.includes\(mode\)/);
 assert.match(source,/if\(mode==='--plan'\)/);
 assert.match(source,/if\(!stopped\)fail\('ZERO_V2_OLD_WORKER_MUST_BE_STOPPED_AND_TIMER_DISABLED'\)/);
 assert.match(source,/label:'zero-v2-vault'/);
 assert.match(source,/maxTotalFee:parseEther\('0\.1'\)/);
 assert.match(source,/journalTransaction/);
 assert.match(source,/acquireCatchupLock\(oldWorkerState,\{waitMilliseconds:0\}\)/);
 assert.match(source,/releaseCatchupLock\(lock\)/);
 assert.match(source,/ZERO_V2_ORACLE_PREFLIGHT_REQUIRED/);
 assert.match(source,/verifyNewDeployerDeployment/);
 assert.match(source,/signerOpened:false,transactionsSigned:0,transactionsSent:0/);
 assert.match(source,/siteConnected:false,automationActive:false/);
 assert.doesNotMatch(source,/systemctl.*(?:stop|disable|restart|enable)/);
 assert.doesNotMatch(source,/fs\.(?:rmSync|unlinkSync|rmdirSync)\(/);
 assert.doesNotMatch(source,/oldState\s*\+\s*['"]\/journal/);
});

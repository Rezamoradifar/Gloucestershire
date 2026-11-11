import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {PREVIOUS_TESTNET_VAULT,ZERO_V2_STATE_DIR,verifyOldReport} from '../scripts/preflight-testnet-zero-v2.mjs';

const file='scripts/preflight-testnet-zero-v2.mjs';
const source=fs.readFileSync(file,'utf8');
const report={
 chainId:97,verified:true,contractAddress:PREVIOUS_TESTNET_VAULT,
 hash:'0x'+'aa'.repeat(32),queue:'0x1111111111111111111111111111111111111111',
 runtimeHash:'0x'+'bb'.repeat(32),block:100,blockHash:'0x'+'cc'.repeat(32)
};

test('zero-v2 preflight requires an explicit read-only operation and never opens a signer',()=>{
 assert.equal(spawnSync(process.execPath,['--check',file],{encoding:'utf8'}).status,0);
 assert.match(source,/process\.argv\[2\]!=='--check'/);
 assert.match(source,/transactionsSent:0/);
 assert.match(source,/signerOpened:false/);
 assert.match(source,/const backupRoot='\/var\/backups\/globaldroptrade'/);
 assert.doesNotMatch(source,/readPrivateKey|new Wallet\(|sendTransaction|eth_sendRawTransaction|\.unlinkSync\(|\.rmSync\(/);
 assert.equal(ZERO_V2_STATE_DIR,'/var/lib/globaldroptrade/testnet-zero-v2');
});

test('old report is bound to the exact previous testnet contract and archive',()=>{
 assert.equal(verifyOldReport(report,{...report}),report);
 assert.throws(()=>verifyOldReport(report,{...report,hash:'0x'+'dd'.repeat(32)}),/BACKUP_DEPLOYMENT_MISMATCH/);
 assert.throws(()=>verifyOldReport({...report,chainId:56},{...report,chainId:56}),/PREVIOUS_REPORT_INVALID/);
 assert.throws(()=>verifyOldReport({...report,contractAddress:'0x2222222222222222222222222222222222222222'},{...report,contractAddress:'0x2222222222222222222222222222222222222222'}),/PREVIOUS_TARGET_CHANGED/);
});

test('the read-only review covers on-chain liabilities and blocks silent reuse of old release',()=>{
 assert.match(source,/function ledgers\(address\) view returns\(uint256 principal,uint256 profit,uint256 feeReserve,uint256 rewards\)/);
 assert.match(source,/function pending\(address\) view returns\(uint256\)/);
 assert.match(source,/queueRequestCount/);
 assert.match(source,/getBlockNumber/);
 assert.match(source,/getCode\(PREVIOUS_TESTNET_VAULT\)/);
 assert.match(source,/oldWorkerTimerActive/);
 assert.match(source,/nextVaultDeployed:false,cutoverPerformed:false/);
 assert.doesNotMatch(source,/writePrivateJson|fs\.writeFile|systemctl.*(stop|disable|enable|restart)/);
});

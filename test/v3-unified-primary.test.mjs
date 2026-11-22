import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {primaryReleaseEnv} from '../scripts/publish-v3-single-capital-primary.mjs';
import {REFERRAL_PROFIT_PROFILE} from '../scripts/v3-unified-release-pins.mjs';

const proof={vault:'0x'+'11'.repeat(20),vaultRuntimeHash:'0x'+'aa'.repeat(32),
 deploymentTx:'0x'+'bb'.repeat(32),book:'0x'+'22'.repeat(20),bookRuntimeHash:'0x'+'cc'.repeat(32),
 network:'0x'+'33'.repeat(20),networkRuntimeHash:'0x'+'dd'.repeat(32)};
const operator='0x'+'44'.repeat(20);
test('the primary build uses the same verified one-hour account, book and operator',()=>{
 const env=primaryReleaseEnv(proof,operator,'disabled');
 assert.equal(env.VITE_V3_CONTRACT_ADDRESS,proof.vault);
 assert.equal(env.VITE_V3_UNIFIED_BOOK,proof.book);
 assert.equal(env.VITE_V3_UNIFIED_NETWORK,proof.network);
 assert.equal(env.VITE_V3_UNIFIED_KEEPER,operator);
 assert.equal(env.VITE_V3_HOURLY_TEST,'isolated-1h');
 assert.equal(env.VITE_V3_LANDING_AT_ROOT,'true');
 assert.equal(env.VITE_V3_UNIFIED_PRIMARY,'single-capital-testnet');
 assert.equal(env.VITE_V3_UNIFIED_WALLET_ACTIONS,'verified-isolated-testnet');
 assert.equal(env.VITE_WALLETCONNECT_PROJECT_ID,'');
 const project='0123456789abcdef0123456789abcdef';
 assert.equal(primaryReleaseEnv(proof,operator,project).VITE_WALLETCONNECT_PROJECT_ID,project);
 assert.throws(()=>primaryReleaseEnv(proof,operator,'unverified'),/WALLET_CONFIG/);
 const corrected=primaryReleaseEnv(proof,operator,'disabled',REFERRAL_PROFIT_PROFILE);
 assert.equal(corrected.VITE_V3_UNIFIED_MODE,'referral-profit-testnet');
 assert.equal(corrected.VITE_V3_UNIFIED_PRIMARY,corrected.VITE_V3_UNIFIED_MODE);
});
test('publication refuses incomplete arguments before checking or changing the server',()=>{
 for(const args of [[],['--install','main'],['--deploy-testnet','a'.repeat(40),'b'.repeat(64),
  'https://bsc-testnet-rpc.publicnode.com']]){
  const result=spawnSync(process.execPath,['scripts/publish-v3-single-capital-primary.mjs',...args],{encoding:'utf8'});
  assert.equal(result.status,1);
  assert.match(result.stderr,/GLOBAL_PRIMARY_ARGUMENTS_INVALID/);
  assert.doesNotMatch(result.stdout,/GLOBAL_PRIMARY_STAGE=/);
 }
});

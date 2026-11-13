import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateV3DeploymentProof} from '../scripts/verify-v3-site-deployment.mjs';

const valid={
 status:'VERIFIED_BNB_TESTNET_ONLY',
 chainId:97,contract:'0x1234567890123456789012345678901234567890',
 asset:'0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89',
 admin:'0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632',
 feeReceiver:'0x74015dedf36677485793f1714ec7bd4893907b26',
 runtimeHash:'0x'+'a'.repeat(64),txHash:'0x'+'b'.repeat(64),
 blockNumber:145000000,deployedV2Unmodified:true
};
test('requires actual V3 deployment proof on BNB Testnet before activating primary dashboard',()=>{
 assert.equal(validateV3DeploymentProof(valid).address,valid.contract);
 for(const broken of [
  {...valid,status:'INTENT'}, {...valid,status:'BROADCAST'},
  {...valid,chainId:56},{...valid,contract:'0xA98D8d3709f5D3730BAD5d76C334731784e7CF07'},
  {...valid,asset:'0x2222222222222222222222222222222222222222'},
  {...valid,admin:'0x3333333333333333333333333333333333333333'},
  {...valid,feeReceiver:'0x4444444444444444444444444444444444444444'},
  {...valid,runtimeHash:'INVALID'},{...valid,txHash:null},
  {...valid,blockNumber:0},{...valid,deployedV2Unmodified:false}
 ])assert.throws(()=>validateV3DeploymentProof(broken));
});
test('V3 site installer cannot activate unverified V3 or erase existing V2 site/history',()=>{
 const installer=fs.readFileSync(new URL('../scripts/install-v3-site-when-verified.sh',import.meta.url),'utf8');
 const launcher=fs.readFileSync(new URL('../scripts/launch-v3-site-after-deployment.sh',import.meta.url),'utf8');
 const verified=fs.readFileSync(new URL('../scripts/verify-v3-site-deployment.mjs',import.meta.url),'utf8');
 for(const needed of [
  'node scripts/verify-v3-site-deployment.mjs --check',
  'node scripts/verify-v3-site-deployment.mjs --emit-site-env',
  'V3_TESTNET_PRIMARY_DASHBOARD_INSTALLED',
  'bash ubuntu-global-v2-site.sh --install'
 ])assert.ok(installer.includes(needed),needed);
 assert.ok(launcher.includes('systemd-run'));
 assert.ok(launcher.includes('V3_SITE_SERVICE_STARTED'));
 assert.ok(verified.includes("rpc.getTransactionReceipt(proof.deploymentTx)"));
 assert.ok(verified.includes("keccak256(code).toLowerCase()!==proof.runtimeHash"));
 assert.ok(verified.includes("getAddress(asset)!==TOKEN"));
 for(const source of [installer,launcher]){
  assert.equal(source.includes('rm -rf /var/lib/globaldroptrade'),false);
  assert.equal(source.includes('TRADES_VAULT_ADDRESS='),false);
 }
});

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ganache from 'ganache';
import {BrowserProvider, ContractFactory, Wallet} from 'ethers';
import {deployUnifiedIsolated} from '../scripts/deploy-v3-unified-isolated.mjs';
import {deploymentArtifact} from '../scripts/v3-unified-deploy-preflight.mjs';
import {PLAN_PORTFOLIO_PROFILE, PORTFOLIO_PROFILE, UNIFIED_TOKEN, unifiedProfileForFlag} from '../scripts/v3-unified-release-pins.mjs';
import {planUnifiedPreviewSite, readPinnedProof} from '../scripts/v3-unified-site-preview-preflight.mjs';
import {verifyUnifiedDeployment} from '../scripts/verify-v3-unified-deployment.mjs';
import {verifyUnifiedRelease} from '../scripts/verify-v3-unified-release.mjs';

test('V8 deployment records its own chain-97 identity and stages only that vault', {timeout:240000}, async () => {
 const profile = unifiedProfileForFlag('--plan-portfolio');
 assert.equal(profile, PLAN_PORTFOLIO_PROFILE);
 for (const key of ['initcodeHash', 'route', 'timer', 'gasKey', 'stateDirectory']) {
  assert.notEqual(profile[key], PORTFOLIO_PROFILE[key]);
 }

 const chain = ganache.provider({logging:{quiet:true}, chain:{chainId:97, hardfork:'shanghai'}});
 const provider = new BrowserProvider(chain, undefined, {cacheTimeout:-1});
 provider.pollingInterval = 20;
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'global-plan-portfolio-proof-'));
 async function mine() { await chain.request({method:'evm_mine', params:[]}); }
 try {
  const operator = await provider.getSigner();
  const mock = JSON.parse(fs.readFileSync('artifacts/MockToken.json','utf8'));
  const token = await new ContractFactory(mock.abi, mock.evm.bytecode.object, operator).deploy(18);
  await token.waitForDeployment();
  await chain.request({method:'evm_setAccountCode', params:[UNIFIED_TOKEN, await provider.getCode(token.target)]});
  for (let i=0;i<4;i++) await mine();
  const signer = new Wallet(Object.values(chain.getInitialAccounts())[1].secretKey, provider);
  const {name,compile} = deploymentArtifact(profile);
  assert.equal(name, 'GlobalV3PlanPortfolioTestnet');
  const result = await deployUnifiedIsolated({provider, signer, directory:dir, expectedDeployer:signer.address, profile, compile,
   waitReceipt:async(reader,hash) => {
    for (let i=0;i<4;i++) await mine();
    return reader.getTransactionReceipt(hash);
   }});
  assert.equal(result.initcodeHash, profile.initcodeHash);
  assert.equal(result.siteUpdated,false);
  assert.equal(result.migrationPerformed,false);
  const filename = path.join(dir, 'deployment-proof.json');
  assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
  const digest = createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
  const proof = readPinnedProof(filename,digest);
  assert.equal(proof.vault,result.vault);
  assert.equal(proof.deploymentTx,result.deploymentTx);

  const sourceSha = '1'.repeat(40);
  const site = await planUnifiedPreviewSite({provider, proof, profile, sourceSha, expectedSourceSha:sourceSha});
  assert.equal(site.routeCandidate, '/plan-portfolio-test/');
  assert.equal(site.env.VITE_V3_CONTRACT_ADDRESS, proof.vault);
  assert.equal(site.env.VITE_V3_UNIFIED_MODE, 'plan-portfolio-testnet');
  assert.equal(site.env.VITE_V3_LANDING_AT_ROOT, 'false');
  await assert.rejects(verifyUnifiedRelease(provider, proof, signer.address, PORTFOLIO_PROFILE), /PROFILE_MISMATCH/);
  await assert.rejects(verifyUnifiedDeployment(provider, {...proof,status:PORTFOLIO_PROFILE.status}), /TERMS_MISMATCH/);
 } finally {
  provider.destroy();
  await chain.disconnect();
  fs.rmSync(dir,{recursive:true,force:true});
 }
});

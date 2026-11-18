import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

const script='scripts/install-v3-unified-test-site.sh';
test('installer shell parses and refuses missing or invalid arguments before modifying files',()=>{
 assert.equal(spawnSync('bash',['-n',script]).status,0);
 const result=spawnSync('bash',[script,'--install','bad'],{encoding:'utf8'});
 assert.notEqual(result.status,0);
 assert.match(result.stdout,/UNIFIED_SITE_(WRONG_SERVER|ARGUMENTS_INVALID)/);
 assert.doesNotMatch(result.stdout,/UNIFIED_SITE_INSTALLED=/);
});

test('build helper rejects untrusted deployment arguments before running npm',()=>{
 const result=spawnSync(process.execPath,['scripts/build-v3-unified-site.mjs','/tmp/a','x','y','https://example.com','disabled'],{encoding:'utf8'});
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/UNIFIED_SITE_BUILD_ARGUMENTS_INVALID/);
 assert.doesNotMatch(result.stdout,/UNIFIED_SITE_BUILD_VERIFIED/);
});

test('site install defaults to read-only and verifies an explicit wallet opt-in before building',()=>{
 const shell=fs.readFileSync(script,'utf8');
 const build=fs.readFileSync('scripts/build-v3-unified-site.mjs','utf8');
 assert.match(shell,/vps-luna-2585/);
 const publisher=fs.readFileSync('scripts/publish-v3-unified-route.py','utf8');
 assert.match(publisher,/UNIFIED_SITE_ROUTE_ALREADY_EXISTS/);
 assert.match(shell,/publish-v3-unified-route\.py/);
 assert.match(shell,/UNIFIED_SITE_LEGACY_CHANGED/);
 assert.match(shell,/UNIFIED_SITE_NEEDS_FREE_INODES_OR_SPACE/);
 assert.match(build,/planUnifiedPreviewSite/);
 assert.match(build,/if\(writes\)verifyActiveWorker\(worker,profile\)/);
 assert.match(build,/if\(writes\)releaseEnv.VITE_V3_UNIFIED_WALLET_ACTIONS='verified-isolated-testnet'/);
 assert.doesNotMatch(shell,/systemctl\s+(?:stop|disable|restart)/);
});

test('wallet activation requires a worker for the same verified release and vault', async () => {
 const {checkWorkerIdentity} = await import('../scripts/v3-unified-worker-readiness.mjs');
 const expected = {sha: 'a'.repeat(40), digest: 'b'.repeat(64), vault: '0x'+'22'.repeat(20)};
 const ready = {sourceSha: expected.sha, proofSha256: expected.digest, chainId: 97,
  vault: expected.vault, operator: '0x'+'33'.repeat(20)};
 checkWorkerIdentity(ready, expected);
 for (const override of [{chainId:56}, {sourceSha: 'c'.repeat(40)}, {proofSha256: 'd'.repeat(64)},
                         {vault: '0x'+'44'.repeat(20)}, {operator: '0x'+'00'.repeat(20)}]) {
  assert.throws(() => checkWorkerIdentity({...ready, ...override}, expected));
 }
});

test('single-capital site writes refuse the previous deployment proof path', () => {
 const result=spawnSync(process.execPath,['scripts/build-v3-unified-site.mjs',
  '/var/lib/globaldroptrade/v3-unified-testnet/deployment-proof.json','a'.repeat(64),'b'.repeat(40),
  'https://bsc-testnet-dataseed.bnbchain.org','disabled','--enable-testnet-wallets','--single-capital'],
  {encoding:'utf8'});
 assert.equal(result.status,1);
 assert.match(result.stderr,/UNIFIED_SITE_PROOF_PATH_MISMATCH/);
});

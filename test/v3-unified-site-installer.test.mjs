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

test('site install is isolated and wallet actions are not opted in',()=>{
 const shell=fs.readFileSync(script,'utf8');
 const build=fs.readFileSync('scripts/build-v3-unified-site.mjs','utf8');
 assert.match(shell,/vps-luna-2585/);
 assert.match(shell,/UNIFIED_SITE_ROUTE_ALREADY_EXISTS/);
 assert.match(shell,/renameat2/);
 assert.match(shell,/UNIFIED_SITE_LEGACY_CHANGED/);
 assert.match(shell,/UNIFIED_SITE_NEEDS_FREE_INODES_OR_SPACE/);
 assert.match(build,/planUnifiedPreviewSite/);
 assert.doesNotMatch(build,/VITE_V3_UNIFIED_WALLET_ACTIONS/);
 assert.doesNotMatch(shell,/systemctl\s+(?:stop|disable|restart)/);
});

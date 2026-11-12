import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const file='ubuntu-account-history-install.sh',source=readFileSync(file,'utf8');
test('history installer has valid shell syntax and an explicit read-only check mode',()=>{
 assert.equal(spawnSync('bash',['-n',file],{encoding:'utf8'}).status,0);
 assert.match(source,/--check\|--install/);
 assert.match(source,/if \[ "\$mode" = --check \]; then/);
 assert.match(source,/ACCOUNT_HISTORY_CHECK_PASS/);
 assert.match(source,/npm run build --prefix website/);
 assert.doesNotMatch(source,/scripts\/unpack-website\.sh|website-release\.tar\.gz/);
});

test('history installer preserves chain97 current vault and unknown live API source fails closed',()=>{
 assert.match(source,/0x4c0f6141b18971db4b14e45c0be8cddb09febc14/);
 assert.match(source,/ACCOUNT_HISTORY_ACTIVE_TESTNET_TARGET_REQUIRED/);
 assert.match(source,/git hash-object "\$previous_api\/server\/trades-api\.mjs"/);
 assert.match(source,/ACCOUNT_HISTORY_LIVE_API_VERSION_REVIEW_REQUIRED/);
 assert.match(source,/ACCOUNT_HISTORY_SITE_ROOT_NOT_VERIFIED/);
 assert.match(source,/ACCOUNT_HISTORY_CONTRACT_TARGET_CHANGED/);
});

test('history installer uses exact static and API rollback and cannot erase financial journals',()=>{
 assert.match(source,/ACCOUNT_HISTORY_PREVIOUS_RELEASE_RESTORED/);
 assert.match(source,/trap cleanup EXIT/);
 assert.match(source,/cp -p "\$backup\/api\.service" "\$unit"/);
 assert.match(source,/ln -sfn "\$previous_api" \/opt\/globaldroptrade-api\/current/);
 assert.match(source,/ACCOUNT_HISTORY_FRONTEND_NOT_SERVED/);
 assert.match(source,/ACCOUNT_HISTORY_API_READ_ONLY_PASS/);
 assert.match(source,/ACCOUNT_HISTORY_SITE_AND_API_INSTALLED/);
 assert.doesNotMatch(source,/rm -rf[^\n]*globaldroptrade-new-deployer|systemctl (?:stop|disable|restart) globaldroptrade-new-deployer|eth_sendRawTransaction|readPrivateKey|sendTransaction/);
});

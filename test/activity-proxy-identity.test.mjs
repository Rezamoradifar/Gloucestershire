import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {activityPeer} from '../server/daily-activity.mjs';

const req=(socket,headers={})=>({socket:{remoteAddress:socket},headers});
test('proxy identity is opt-in and never trusts arbitrary forwarded headers',()=>{
 const headers={'x-global-client-ip':'198.51.100.7','x-forwarded-for':'203.0.113.1','cf-connecting-ip':'203.0.113.2'};
 assert.equal(activityPeer(req('127.0.0.1',headers)), '127.0.0.1');
 assert.equal(activityPeer(req('203.0.113.9',headers),true), '203.0.113.9');
 assert.equal(activityPeer(req('127.0.0.1',headers),true), '198.51.100.7');
 assert.equal(activityPeer(req('::ffff:127.0.0.1',headers),true), '198.51.100.7');
});
test('missing, multiple, or invalid proxy identities fall back to shared peer',()=>{
 for(const value of [undefined,'203.0.113.1, 198.51.100.1','evil','[::1]',['198.51.100.1']]){
  assert.equal(activityPeer(req('127.0.0.1',{'x-global-client-ip':value}),true),'127.0.0.1');
 }
});
test('managed Nginx overwrites the header using its direct peer',()=>{
 const source=fs.readFileSync('scripts/install-website.sh','utf8');
 assert.match(source,/proxy_set_header X-Global-Client-IP \$remote_addr;/);
 assert.doesNotMatch(source,/proxy_set_header X-Global-Client-IP \$http_/);
});

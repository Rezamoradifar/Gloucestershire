import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('deployment console bytecode and verification sources match the freshly compiled contract',()=>{
 const artifact=JSON.parse(fs.readFileSync('artifacts/DropshippingVault.json'));
 const consoleArtifact=JSON.parse(fs.readFileSync('deployment-console/DropshippingVault.json'));
 const input=JSON.parse(fs.readFileSync('artifacts/standard-input.json'));
 assert.equal(consoleArtifact.bytecode,'0x'+artifact.evm.bytecode.object);
 assert.deepEqual(consoleArtifact.abi,artifact.abi);
 for(const name of fs.readdirSync('contracts').filter(x=>x.endsWith('.sol')))assert.equal(input.sources[name].content,fs.readFileSync('contracts/'+name,'utf8'));
 assert.ok(artifact.evm.deployedBytecode.object.length/2<=24576);
});

import fs from 'node:fs';
const artifact=JSON.parse(fs.readFileSync('artifacts/DropshippingVault.json','utf8'));
fs.writeFileSync('deployment-console/DropshippingVault.json',JSON.stringify({abi:artifact.abi,bytecode:'0x'+artifact.evm.bytecode.object,compiler:artifact.compiler},null,2)+'\n');
fs.writeFileSync('website/src/vault-abi.json',JSON.stringify(artifact.abi,null,2)+'\n');
console.log('Synchronized deployment console and frontend ABI with compiled contract.');

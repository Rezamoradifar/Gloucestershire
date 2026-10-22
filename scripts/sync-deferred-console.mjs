import fs from 'node:fs';
const text=fs.readFileSync('scripts/deferred-migration-core.mjs','utf8').replace("from 'ethers'","from './ethers.js'");
fs.writeFileSync('deployment-console/deferred-migration-core.mjs',text);
console.log('Synchronized read-only migration verification for the owner console.');

import test from 'node:test';
import assert from 'node:assert/strict';
import {AbiCoder,getAddress} from 'ethers';
import {prepareHourlyVerification,assertMatchingBuild,sourcePath,contractName,
 constructorArguments,constructorAddresses,expectedCreationHash} from '../scripts/prepare-v3-hourly-verification.mjs';

test('hourly explorer package is self-contained and exactly reproduces pinned creation bytecode',()=>{
 const input=prepareHourlyVerification(); // compiles with callback and again with no callback
 assert.equal(input.language,'Solidity');
 assert.equal(contractName,sourcePath+':GlobalV3HourlyTestnet');
 assert.equal(input.settings.optimizer.enabled,true);
 assert.equal(input.settings.optimizer.runs,1);
 assert.equal(input.settings.viaIR,true);
 assert.equal(input.settings.evmVersion,'shanghai');
 assert.ok(Object.keys(input.sources).length>3);
 assert.match(input.sources[sourcePath].content,/contract GlobalV3HourlyTestnet is/);
 assert.match(input.sources[sourcePath].content,/ACCRUAL_PERIOD = 1 hours/);
 assert.match(input.sources[sourcePath].content,/if\(block\.chainid!=97\) revert WrongChain\(\);/);
 assert.equal(expectedCreationHash,'0xffd714456c8dfda35333b1bca7707e34010b602252c8ac3127e997331047dfc0');
 const decoded=AbiCoder.defaultAbiCoder().decode(['address','address','address'],'0x'+constructorArguments);
 assert.deepEqual([...decoded],constructorAddresses.map(getAddress));
});

test('an absent or altered bytecode build cannot produce a verification package',()=>{
 const artifact={evm:{bytecode:{object:'00'},deployedBytecode:{object:'01'}}};
 assert.throws(()=>assertMatchingBuild(artifact,artifact),/BYTECODE_MISMATCH/);
 assert.throws(()=>assertMatchingBuild({},artifact),/BYTECODE_MISMATCH/);
});

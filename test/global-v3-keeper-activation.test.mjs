import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Wallet,parseEther} from 'ethers';
import {keeperReadiness} from '../scripts/global-v3-auto-compound-keeper.mjs';
import {waitV3KeeperReceipt} from '../scripts/v3-keeper-receipt-poll.mjs';

const worker=fileURLToPath(new URL('../scripts/global-v3-auto-compound-keeper.mjs',import.meta.url));
const installer=fs.readFileSync(new URL('../scripts/install-global-v3-keeper-timer.sh',import.meta.url),'utf8');
const source=fs.readFileSync(worker,'utf8');
const base={balance:parseEther('0.005'),privileged:false,paused:false};
test('gas-only funded, nonprivileged, unpaused testnet signer is ready',()=>{
 assert.equal(keeperReadiness(base).ready,true);
 assert.equal(keeperReadiness(base).minimumTestBNB,'0.001');
});
test('zero tBNB and below-minimum balance prevent readiness',()=>{
 assert.equal(keeperReadiness({...base,balance:0n}).ready,false);
 assert.equal(keeperReadiness({...base,balance:parseEther('0.0009')}).ready,false);
 assert.equal(keeperReadiness({...base,balance:parseEther('0.001')}).ready,true);
});
test('admin privileges or paused contract block readiness',()=>{
 assert.equal(keeperReadiness({...base,privileged:true}).ready,false);
 assert.equal(keeperReadiness({...base,paused:true}).ready,false);
});
test('malformed readiness values fail closed',()=>{
 assert.throws(()=>keeperReadiness({...base,balance:-1n}));
 assert.throws(()=>keeperReadiness({...base,privileged:'false'}));
 assert.throws(()=>keeperReadiness({...base,paused:undefined}));
});
test('offline address command prints only public address; accepts private read-only systemd credential',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v3-keeper-test-'));
 try{
  const wallet=Wallet.createRandom();
  const key=path.join(dir,'test.key');
  fs.writeFileSync(key,wallet.privateKey+'\n',{mode:0o600});
  fs.chmodSync(key,0o400);
  const out=spawnSync(process.execPath,[worker,'--public-address','--key-file',key],{encoding:'utf8'});
  assert.equal(out.status,0,out.stderr);
  assert.equal(out.stdout.trim(),'V3_KEEPER_GAS_ONLY_PUBLIC_ADDRESS='+wallet.address);
  assert.equal((out.stdout+out.stderr).includes(wallet.privateKey),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('address command rejects world-readable and symlink signing files',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v3-keeper-test-'));
 try{
  const wallet=Wallet.createRandom();
  const key=path.join(dir,'test.key');
  fs.writeFileSync(key,wallet.privateKey+'\n',{mode:0o600});
  fs.chmodSync(key,0o644);
  const open=spawnSync(process.execPath,[worker,'--public-address','--key-file',key],{encoding:'utf8'});
  assert.notEqual(open.status,0);
  assert.equal((open.stdout+open.stderr).includes(wallet.privateKey),false);
  fs.chmodSync(key,0o600);
  const link=path.join(dir,'link.key');fs.symlinkSync(key,link);
  const linked=spawnSync(process.execPath,[worker,'--public-address','--key-file',link],{encoding:'utf8'});
  assert.notEqual(linked.status,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
const hash='0x'+'a'.repeat(64);
const receipt={hash,status:1,blockNumber:100,logs:[]};
test('receipt poll waits for real confirmation depth without a background listener',async()=>{
 let reads=0,heights=0;
 const provider={
  async getTransactionReceipt(){return ++reads>1?receipt:null;},
  async getBlockNumber(){return ++heights===1?100:101;}
 };
 const result=await waitV3KeeperReceipt(provider,hash,{confirmations:2,pollMs:0,delay:async()=>{}});
 assert.equal(result,receipt);assert.equal(reads,3);assert.equal(heights,2);
});
test('wrong or reverted receipt never counts as internal profit credit',async()=>{
 for(const bad of [{...receipt,status:0},{...receipt,hash:'0x'+'b'.repeat(64)},{...receipt,blockNumber:0}]){
  const provider={getTransactionReceipt:async()=>bad,getBlockNumber:async()=>1000};
  await assert.rejects(()=>waitV3KeeperReceipt(provider,hash),/WRONG_RECEIPT/);
 }
});
test('missing receipt times out instead of reporting successful accrual',async()=>{
 let clock=0;
 const provider={getTransactionReceipt:async()=>null,getBlockNumber:async()=>1000};
 await assert.rejects(()=>waitV3KeeperReceipt(provider,hash,{
  timeoutMs:1000,pollMs:0,now:()=>clock+=250,delay:async()=>{}
 }),/RECEIPT_TIMEOUT/);
});
test('installed code and dependencies are readable, keys stay private, installer starts no mainnet task',()=>{
 assert.ok(installer.includes('umask 022; cd "$stage"; npm ci --omit=dev --ignore-scripts'));
 assert.ok(installer.includes('chmod -R u+rwX,go+rX,go-w "$stage"'));
 assert.ok(installer.includes('StateDirectoryMode=0700'));
 assert.ok(installer.includes('DynamicUser=yes'));
 assert.ok(installer.includes('LoadCredential=keeper-gas-key:$KEY'));
 assert.ok(installer.includes('scripts/v3-keeper-receipt-poll.mjs'));
 assert.ok(installer.includes('systemctl start --no-block "$UNIT.service"'));
 assert.ok(installer.includes('V3_FIRST_RUN_REQUESTED_NOT_YET_VERIFIED'));
 assert.equal(installer.includes('chmod 644 "$KEY"'),false);
 assert.equal(installer.includes('--deploy-old-testnet-deployer'),false);
});
test('signer, gas and role readiness precede enabling timer',()=>{
 const check=installer.indexOf('--check --config "$CONFIG" --key-file "$KEY"');
 const enable=installer.indexOf('systemctl enable --now');
 assert.ok(check>0&&enable>check);
 assert.ok(installer.includes('V3_KEEPER_EXISTING_KEY_PRESERVED'));
 assert.ok(installer.includes('git -C "$BASE" diff --quiet HEAD'));
});
test('worker limits actual signed gas and never mislabels no-due run as a payout',()=>{
 assert.ok(source.includes('accrueDaily(item.member,item.positionId,{gasLimit,gasPrice})'));
 assert.ok(source.includes('await waitV3KeeperReceipt(provider,hash,{confirmations:2})'));
 assert.equal(source.includes('await tx.wait('),false);
 assert.ok(source.includes("'NO_DUE_POSITIONS'"));
 assert.ok(source.includes('deferred?plan.start:plan.next'));
 assert.ok(source.includes('realAssetTransfers:false'));
});

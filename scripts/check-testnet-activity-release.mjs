import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';

const target='0x4c0f6141b18971db4b14e45c0be8cddb09febc14';
const liveBundleHash='9a7ef0c9c0d3565ef4bfb786b5d7b218dc8e49b94667964c4b1f3e2fb2a616fd';
export function walletId(body,expectedHash){
 if(expectedHash&&crypto.createHash('sha256').update(body).digest('hex')!==expectedHash)throw Error('TESTNET_ACTIVITY_LIVE_BUNDLE_CHANGED');
 const uses=[...body.matchAll(/\.init\(\{projectId:([A-Za-z_$][A-Za-z0-9_$]*)/g)];
 if(uses.length!==1)throw Error('TESTNET_ACTIVITY_WALLET_ID_REQUIRED');
 const variable=uses[0][1].replace(/[$]/g,'\\$&');
 const values=[...body.matchAll(new RegExp('\\b'+variable+'="([a-f0-9]{32})"\\.trim\\(\\)','gi'))];
 if(values.length!==1)throw Error('TESTNET_ACTIVITY_WALLET_ID_REQUIRED');
 return values[0][1];
}
export function checkConfig(value){
 if(value?.version!==1||value.chainId!==97||typeof value.vaultAddress!=='string'||value.vaultAddress.toLowerCase()!==target)
  throw Error('TESTNET_ACTIVITY_TARGET_MISMATCH');
}
export function checkActivity(value){
 if(value?.version!==1||value.chainId!==97||typeof value.vaultAddress!=='string'||value.vaultAddress.toLowerCase()!==target||
  value.wallet!=='0x0000000000000000000000000000000000000001'||value.windowSeconds!==86400||
  value.requirementEnabled!==true||!Number.isSafeInteger(value.activationTimestamp)||value.activationTimestamp<1)
  throw Error('TESTNET_ACTIVITY_API_MISMATCH');
}
export function checkBuild(directory){
 const html=fs.readFileSync(path.join(directory,'index.html'),'utf8');
 const moduleScript=html.match(/<script\b[^>]*type="module"[^>]*>/)?.[0];
 const entry=moduleScript?.match(/\bsrc="(\.?\/assets\/[A-Za-z0-9._-]+\.js)"/)?.[1];
 if(!entry||!fs.existsSync(path.join(directory,entry.replace(/^\.?\//,''))))throw Error('TESTNET_ACTIVITY_BUILD_ENTRY_REQUIRED');
 const assets=path.join(directory,'assets');
 const files=fs.readdirSync(assets).filter(file=>file.endsWith('.js'));
 const bodies=files.map(file=>fs.readFileSync(path.join(assets,file),'utf8'));
 const matched=bodies.filter(body=>body.includes('Daily activity')&&body.includes('Check in for 24 hours'));
 if(matched.length!==1)throw Error('TESTNET_ACTIVITY_BUILD_MISSING');
 const expected=process.env.VITE_WALLETCONNECT_PROJECT_ID;
 if(!/^[a-f0-9]{32}$/i.test(expected||'')||walletId(matched[0])!==expected)throw Error('TESTNET_ACTIVITY_WALLET_ID_MISMATCH');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{
  if(process.argv.length!==4)throw Error('TESTNET_ACTIVITY_EXPLICIT_CHECK_REQUIRED');
  if(process.argv[2]==='--wallet'){
   process.stdout.write(walletId(fs.readFileSync(process.argv[3],'utf8'),liveBundleHash));
   process.exit(0);
  }
  if(process.argv[2]==='--config')checkConfig(JSON.parse(fs.readFileSync(process.argv[3],'utf8')));
  else if(process.argv[2]==='--activity')checkActivity(JSON.parse(fs.readFileSync(process.argv[3],'utf8')));
  else if(process.argv[2]==='--build')checkBuild(process.argv[3]);
  else throw Error('TESTNET_ACTIVITY_EXPLICIT_CHECK_REQUIRED');
  console.log('TESTNET_ACTIVITY_RELEASE_CHECK_PASSED');
 }catch(error){console.error(/^[A-Z_]+$/.test(error?.message||'')?error.message:'TESTNET_ACTIVITY_RELEASE_CHECK_FAILED');process.exitCode=1;}
}

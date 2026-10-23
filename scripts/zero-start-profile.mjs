import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

// Profiles are selected only by an explicit command argument. Never select a
// financial journal or deployment from an inherited environment variable.
export function getZeroStartProfile(fast=false){
 if(typeof fast!=='boolean')throw Error('ZERO_START_EXPLICIT_PROFILE_REQUIRED');
 const release=JSON.parse(fs.readFileSync(new URL(fast?'../config/fresh-fast-testnet.json':'../config/fresh-zero-testnet.json',import.meta.url),'utf8'));
 const artifactName=fast?'FastTestnetVault':'AutomaticGroupVault';
 const artifactUrl=new URL('../artifacts/'+artifactName+'.json',import.meta.url);
 const stateDir='/var/lib/globaldroptrade/'+(fast?'fresh-fast-testnet-v1':'fresh-zero-v1');
 return {
  fast,release,artifactName,artifactUrl,artifactPath:fileURLToPath(artifactUrl),
  stateDir,deploymentDir:stateDir,
  automationDir:'/var/lib/globaldroptrade/'+(fast?'fresh-fast-testnet-automation-v1':'fresh-zero-automation-v1'),
  connectionLockDir:'/var/lib/globaldroptrade/'+(fast?'fresh-fast-testnet-connection':'fresh-zero-connection'),
  publicRoot:'/var/www/globaldroptrade/automation-data',
  service:'globaldroptrade-zero-daily.service',timer:'globaldroptrade-zero-daily.timer'
 };
}

export function parseZeroStartProfileArgs(args=process.argv.slice(2)){
 if(!Array.isArray(args)||!args.every(value=>typeof value==='string'))throw Error('ZERO_START_ARGUMENTS_REQUIRED');
 const flags=args.filter(value=>value==='--fast-testnet');
 if(flags.length>1)throw Error('ZERO_START_DUPLICATE_PROFILE_FLAG');
 return {profile:getZeroStartProfile(flags.length===1),args:args.filter(value=>value!=='--fast-testnet')};
}

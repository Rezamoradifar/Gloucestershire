// Read the single public WalletConnect project id from a reviewed Vite build.
import fs from 'node:fs';
import path from 'node:path';

export function readWalletConfig(root,owner=process.getuid?.(),allowDisabled=false){
 const assets=path.join(root,'assets'), ids=new Set();
 for(const name of fs.readdirSync(assets)){
  if(!name.endsWith('.js'))continue;
  const file=path.join(assets,name), stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.uid!==owner||(stat.mode&0o022)!==0||stat.size>15_000_000)
   throw Error('V3_PRIMARY_WALLET_ASSET_UNSAFE');
  const source=fs.readFileSync(file,'utf8');
  for(const use of source.matchAll(/\.init\(\{projectId:([A-Za-z_$][A-Za-z0-9_$]*)/g)){
   const variable=use[1].replace(/[$]/g,'\\$&');
   const values=[...source.matchAll(new RegExp('(?:^|[,;\\s])'+variable+'="([a-f0-9]{32}|)"\\.trim\\(\\)','gi'))];
   if(values.length===0)continue;
   if(values.length!==1)throw Error('V3_PRIMARY_WALLET_ID_UNVERIFIED');
   ids.add(values[0][1].toLowerCase()||'disabled');
  }
 }
 if(ids.size===0&&allowDisabled)return 'disabled';
 if(ids.size!==1)throw Error('V3_PRIMARY_WALLET_ID_UNVERIFIED');
 return [...ids][0];
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{
  if(process.argv.length!==3&&!(process.argv.length===4&&process.argv[3]==='--allow-disabled'))
   throw Error('V3_PRIMARY_WALLET_CONFIG_USAGE');
  process.stdout.write(readWalletConfig(process.argv[2],undefined,process.argv[3]==='--allow-disabled'));
 }catch(error){console.error(String(error?.message||error));process.exitCode=1;}
}

#!/usr/bin/env node
// Read-only acceptance gate for the complete legacy UI against an independent V2 vault.
// Never changes nginx, workers, databases, journals, accounts, or blockchain state.
import {existsSync,readFileSync} from 'node:fs';
import {getAddress,isAddress,ZeroAddress} from 'ethers';

const OLD_TESTNET_VAULT='0x4C0F6141b18971db4b14e45c0bE8CddB09febc14';
const fail=(message)=>{console.error('V2_SITE_PREFLIGHT_BLOCKED: '+message);process.exitCode=1;};
const address=(value,name)=>{
 if(!value||!isAddress(value)||getAddress(value)===ZeroAddress)throw Error(name+' must be a nonzero EVM address');
 return getAddress(value);
};
const requiredFiles=[
 'website/src/App.tsx','website/src/chain.ts','website/src/wallet.ts',
 'website/src/WithdrawalRequests.tsx','website/src/NetworkRewards.tsx',
 'website/src/AccountDetails.tsx','website/src/AdminOverview.tsx',
 'website/src/config.ts','website/src/runtime-config.ts',
 'server/trades-api.mjs','ubuntu-marketplace.sh'
];
async function main(){
 if(process.argv.slice(2).join(' ')!=='--check')throw Error('Read-only usage: node scripts/v2-site-preflight.mjs --check');
 const missing=requiredFiles.filter(path=>!existsSync(path));
 if(missing.length)throw Error('Legacy full-site source is incomplete: '+missing.join(', '));
 const chain=Number(process.env.TRADES_CHAIN_ID);
 if(![56,97].includes(chain))throw Error('Set TRADES_CHAIN_ID to 56 or 97');
 const expected=address(process.env.V2_EXPECTED_VAULT_ADDRESS,'V2_EXPECTED_VAULT_ADDRESS');
 const api=address(process.env.TRADES_VAULT_ADDRESS,'TRADES_VAULT_ADDRESS');
 if(api!==expected)throw Error('API is not pinned to expected V2 contract');
 if(api===getAddress(OLD_TESTNET_VAULT))throw Error('Old testnet contract is forbidden');
 if(process.env.VITE_VAULT_ADDRESS&&address(process.env.VITE_VAULT_ADDRESS,'VITE_VAULT_ADDRESS')!==api)
  throw Error('Website build address differs from V2 API address');
 if(process.env.VITE_CHAIN_ID&&Number(process.env.VITE_CHAIN_ID)!==chain)
  throw Error('Website build chain differs from V2 API chain');
 const endpoint=process.env.TRADES_RPC_URL;
 if(!endpoint||!/^https?:\/\//.test(endpoint))throw Error('A real RPC endpoint is required');
 const rpc=async(method,params=[])=>{
  const res=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(12000)});
  if(!res.ok)throw Error('RPC HTTP error '+res.status);
  const body=await res.json();
  if(body.error||!('result' in body))throw Error('RPC returned an error for '+method);
  return body.result;
 };
 const liveChain=Number(BigInt(await rpc('eth_chainId')));
 if(liveChain!==chain)throw Error('RPC is on a different chain');
 const code=await rpc('eth_getCode',[api,'latest']);
 if(!/^0x(?:[0-9a-fA-F]{2})+$/.test(code))throw Error('Expected V2 has no deployed bytecode');
 const app=readFileSync('website/src/App.tsx','utf8');
 for(const feature of ['WithdrawalRequests','NetworkRewards','AccountDetails','AdminOverview']){
  if(!app.includes(feature))throw Error('Legacy feature is missing from app: '+feature);
 }
 console.log(JSON.stringify({result:'V2_SITE_READONLY_PREFLIGHT_PASS',chainId:chain,vault:api,sourceModulesChecked:requiredFiles.length,bytecodePresent:true,checked:'RPC target + UI source only',productionReady:false},null,2));
 console.log('NOT VERIFIED: contract artifact identity, balances, backend worker, payouts, financial obligations, or live site. No mutation performed.');
}
main().catch(error=>fail(error.message));

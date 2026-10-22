import {getAddress,isAddress,ZeroAddress} from 'ethers';
export type PublicConfig={chainId:number;vaultAddress:string};
export function parsePublicConfig(value:unknown,legacy=false):PublicConfig{
 const v=value as Record<string,unknown>|null;
 if(!v||!Number.isInteger(v.chainId)||![56,97].includes(Number(v.chainId)))throw Error('Unsupported public network configuration.');
 if(legacy?(v.status!=='live'||v.source!=='contract-sales-settlements'):v.version!==1)throw Error('The contract connection could not be verified.');
 const address=legacy?v.contract:v.vaultAddress;
 if(typeof address!=='string'||!isAddress(address)||address.toLowerCase()===ZeroAddress)throw Error('The public contract address is invalid.');
 return {chainId:Number(v.chainId),vaultAddress:getAddress(address)};
}
export async function fetchPublicConfig(fetcher:typeof fetch=fetch):Promise<PublicConfig>{
 for(const [url,legacy] of [['/api/config',false],['/api/trades?limit=1',true]] as const){
  const response=await fetcher(url,{cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!legacy&&response.status===404)continue;
  if(!response.ok)throw Error('The configured contract service is unavailable. Retry shortly.');
  return parsePublicConfig(await response.json(),legacy);
 }
 throw Error('No verified public contract configuration is available.');
}

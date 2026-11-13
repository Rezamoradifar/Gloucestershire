import {getAddress,isAddress,ZeroAddress} from 'ethers';

export type PublicConfig={chainId:number;vaultAddress:string};

// A new, isolated V2 interface must never silently attach to the old deployment.
// The historical vault is preserved on-chain, but it is not a permitted live target.
const expectedTestnetV2='0xA98D8d3709f5D3730BAD5d76C334731784e7CF07';
const forbiddenVaults=new Set([
 '0x4c0f6141b18971db4b14e45c0be8cddb09febc14'
]);

export function parsePublicConfig(value:unknown,legacy=false):PublicConfig{
 const v=value as Record<string,unknown>|null;
 if(!v||!Number.isInteger(v.chainId)||![56,97].includes(Number(v.chainId)))throw Error('Unsupported public network configuration.');
 if(legacy)throw Error('Legacy contract discovery is disabled for the independent V2 site.');
 if(v.version!==1)throw Error('The contract connection could not be verified.');
 const address=v.vaultAddress;
 if(typeof address!=='string'||!isAddress(address)||address.toLowerCase()===ZeroAddress)throw Error('The public contract address is invalid.');
 const vaultAddress=getAddress(address);
 if(forbiddenVaults.has(vaultAddress.toLowerCase()))throw Error('The API still points to the old contract. V2 access is blocked until the new deployment is verified.');
 if(Number(v.chainId)!==97||vaultAddress.toLowerCase()!==expectedTestnetV2.toLowerCase())throw Error('The API is not pinned to the approved isolated V2 testnet address. Transactions are blocked.');
 return {chainId:Number(v.chainId),vaultAddress};
}

export async function fetchPublicConfig(fetcher:typeof fetch=fetch):Promise<PublicConfig>{
 // No legacy fallback. Never infer a transaction target from trading history.
 const response=await fetcher('/api/config',{cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('The V2 contract configuration service is unavailable. No wallet transactions are permitted.');
 return parsePublicConfig(await response.json());
}

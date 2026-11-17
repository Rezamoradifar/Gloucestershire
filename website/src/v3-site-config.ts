// Strict V3 PUBLIC-TESTNET release identity. This must come from the operator's
// verified /var/lib/globaldroptrade/v3-prototype/deployment.json, after an
// actual on-chain deploy. There is intentionally NO hardcoded guessed address.
import {getAddress,isAddress,ZeroAddress} from 'ethers';

export const V3_TESTNET_CHAIN_ID=97;
// An opt-in build for a separately deployed and verified test contract only.
export const V3_HOURLY_TEST=import.meta.env.VITE_V3_HOURLY_TEST==='isolated-1h';
export const V3_TEST_TOKEN=getAddress('0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89');
export const V3_OLD_V2_ADDRESS=getAddress('0xA98D8d3709f5D3730BAD5d76C334731784e7CF07');
export type V3UnifiedConfig={book:string;bookRuntimeHash:string;network:string;networkRuntimeHash:string};
export type V3SiteReleaseConfig={address:string;runtimeHash:string;deploymentTx:string;unified?:V3UnifiedConfig};
const hash=(v:unknown):v is string=>typeof v==='string'&&/^0x[a-fA-F0-9]{64}$/.test(v);
export function v3ParseReleaseConfig(raw:{
 address?:unknown;runtimeHash?:unknown;deploymentTx?:unknown;unifiedMode?:unknown;
 book?:unknown;bookRuntimeHash?:unknown;network?:unknown;networkRuntimeHash?:unknown
}):V3SiteReleaseConfig|null{
 if(!raw||typeof raw.address!=='string'||!isAddress(raw.address)||
  !hash(raw.runtimeHash)||!hash(raw.deploymentTx))return null;
 const address=getAddress(raw.address);
 if(address===ZeroAddress||address===V3_OLD_V2_ADDRESS)return null;
 let unified:V3UnifiedConfig|undefined;
 if(raw.unifiedMode!==undefined&&raw.unifiedMode!==''){
  if(raw.unifiedMode!=='unified-testnet'||typeof raw.book!=='string'||!isAddress(raw.book)||
    typeof raw.network!=='string'||!isAddress(raw.network)||!hash(raw.bookRuntimeHash)||!hash(raw.networkRuntimeHash))return null;
  const book=getAddress(raw.book),network=getAddress(raw.network);
  if(book===ZeroAddress||network===ZeroAddress||new Set([address,book,network]).size!==3)return null;
  unified=Object.freeze({book,network,bookRuntimeHash:raw.bookRuntimeHash.toLowerCase(),
   networkRuntimeHash:raw.networkRuntimeHash.toLowerCase()});
 }
 return Object.freeze({
  address,runtimeHash:raw.runtimeHash.toLowerCase(),deploymentTx:raw.deploymentTx.toLowerCase(),
  ...(unified?{unified}:{})
 });
}

// Strict V3 PUBLIC-TESTNET release identity. This must come from the operator's
// verified /var/lib/globaldroptrade/v3-prototype/deployment.json, after an
// actual on-chain deploy. There is intentionally NO hardcoded guessed address.
import {getAddress,isAddress} from 'ethers';

export const V3_TESTNET_CHAIN_ID=97;
export const V3_TEST_TOKEN=getAddress('0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89');
export const V3_OLD_V2_ADDRESS=getAddress('0xA98D8d3709f5D3730BAD5d76C334731784e7CF07');
export type V3SiteReleaseConfig={address:string;runtimeHash:string;deploymentTx:string};
const hash=(v:unknown):v is string=>typeof v==='string'&&/^0x[a-fA-F0-9]{64}$/.test(v);
export function v3ParseReleaseConfig(raw:{
 address?:unknown;runtimeHash?:unknown;deploymentTx?:unknown
}):V3SiteReleaseConfig|null{
 if(!raw||typeof raw.address!=='string'||!isAddress(raw.address)||
  !hash(raw.runtimeHash)||!hash(raw.deploymentTx))return null;
 const address=getAddress(raw.address);
 if(address===V3_OLD_V2_ADDRESS)return null;
 return Object.freeze({
  address,runtimeHash:raw.runtimeHash.toLowerCase(),deploymentTx:raw.deploymentTx.toLowerCase()
 });
}

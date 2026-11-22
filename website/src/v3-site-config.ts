// Strict V3 PUBLIC-TESTNET release identity. This must come from the operator's
// verified /var/lib/globaldroptrade/v3-prototype/deployment.json, after an
// actual on-chain deploy. There is intentionally NO hardcoded guessed address.
import {getAddress,isAddress,ZeroAddress} from 'ethers';

export const V3_TESTNET_CHAIN_ID=97;
// An opt-in build for a separately deployed and verified test contract only.
export const V3_HOURLY_TEST=import.meta.env.VITE_V3_HOURLY_TEST==='isolated-1h';
export const V3_TEST_TOKEN=getAddress('0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89');
export const V3_OLD_V2_ADDRESS=getAddress('0xA98D8d3709f5D3730BAD5d76C334731784e7CF07');
export const V3_DAILY_CAPITAL_PATH='/daily-capital-test/';
export const V3_DAILY_PLAN=import.meta.env.VITE_V3_UNIFIED_MODE==='daily-capital-testnet';
export const V3_SINGLE_CAPITAL_PATH='/single-capital-test/';
export const V3_REFERRAL_PROFIT_PATH='/referral-profit-test/';
export const V3_MANUAL_REINVEST_PATH='/manual-reinvest-test/';
export const V3_MANUAL_REINVEST=import.meta.env.VITE_V3_UNIFIED_MODE==='manual-reinvest-testnet';
export type V3UnifiedConfig={book:string;bookRuntimeHash:string;network:string;networkRuntimeHash:string;singleCapital?:true;dailyPlan?:true;baseProfitReferrals?:true;manualReinvest?:true;keeper?:string};
export type V3SiteReleaseConfig={address:string;runtimeHash:string;deploymentTx:string;unified?:V3UnifiedConfig};
const hash=(v:unknown):v is string=>typeof v==='string'&&/^0x[a-fA-F0-9]{64}$/.test(v);
export function v3ParseReleaseConfig(raw:{
 address?:unknown;runtimeHash?:unknown;deploymentTx?:unknown;unifiedMode?:unknown;
 book?:unknown;bookRuntimeHash?:unknown;network?:unknown;networkRuntimeHash?:unknown;keeper?:unknown
}):V3SiteReleaseConfig|null{
 if(!raw||typeof raw.address!=='string'||!isAddress(raw.address)||
  !hash(raw.runtimeHash)||!hash(raw.deploymentTx))return null;
 const address=getAddress(raw.address);
 if(address===ZeroAddress||address===V3_OLD_V2_ADDRESS)return null;
 let unified:V3UnifiedConfig|undefined;
 if(raw.unifiedMode!==undefined&&raw.unifiedMode!==''){
  if((raw.unifiedMode!=='unified-testnet'&&raw.unifiedMode!=='single-capital-testnet'&&raw.unifiedMode!=='daily-capital-testnet'&&raw.unifiedMode!=='referral-profit-testnet'&&raw.unifiedMode!=='manual-reinvest-testnet')||
    typeof raw.book!=='string'||!isAddress(raw.book)||
    typeof raw.network!=='string'||!isAddress(raw.network)||!hash(raw.bookRuntimeHash)||!hash(raw.networkRuntimeHash))return null;
  const book=getAddress(raw.book),network=getAddress(raw.network);
  if(book===ZeroAddress||network===ZeroAddress||new Set([address,book,network]).size!==3)return null;
  let keeper:string|undefined;
  if(raw.keeper!==undefined&&raw.keeper!==''){
   if(typeof raw.keeper!=='string'||!isAddress(raw.keeper))return null;
   keeper=getAddress(raw.keeper);
   if([ZeroAddress,address,book,network,V3_TEST_TOKEN].includes(keeper))return null;
  }
  unified=Object.freeze({book,network,bookRuntimeHash:raw.bookRuntimeHash.toLowerCase(),
   networkRuntimeHash:raw.networkRuntimeHash.toLowerCase(),
   ...(keeper?{keeper}:{}),
   ...(raw.unifiedMode==='daily-capital-testnet'?{singleCapital:true as const,dailyPlan:true as const}:
    raw.unifiedMode==='manual-reinvest-testnet'?{singleCapital:true as const,baseProfitReferrals:true as const,manualReinvest:true as const}:
    raw.unifiedMode==='referral-profit-testnet'?{singleCapital:true as const,baseProfitReferrals:true as const}:
    raw.unifiedMode==='single-capital-testnet'?{singleCapital:true as const}:{})});
 }
 return Object.freeze({
  address,runtimeHash:raw.runtimeHash.toLowerCase(),deploymentTx:raw.deploymentTx.toLowerCase(),
  ...(unified?{unified}:{})
 });
}

// Wallet writes are restricted to the separately built, verified hourly release.
export function unifiedWalletEnabled(config:V3SiteReleaseConfig|null,path:string,
 hourly=V3_HOURLY_TEST,primary=import.meta.env.VITE_V3_PRIMARY_DASHBOARD,mode=import.meta.env.VITE_V3_UNIFIED_WALLET_ACTIONS,
 unifiedPrimary=import.meta.env.VITE_V3_UNIFIED_PRIMARY){
 const page=path.endsWith('/index.html')?path.slice(0,-'index.html'.length):path;
 const daily=config?.unified?.dailyPlan===true;
 const corrected=config?.unified?.baseProfitReferrals===true;
 const manual=config?.unified?.manualReinvest===true;
 const route=manual?V3_MANUAL_REINVEST_PATH:daily?V3_DAILY_CAPITAL_PATH:corrected?V3_REFERRAL_PROFIT_PATH:config?.unified?.singleCapital?V3_SINGLE_CAPITAL_PATH:'/unified-test/';
 const root=!daily&&config?.unified?.singleCapital&&(corrected
  ?unifiedPrimary===(manual?'manual-reinvest-testnet':'referral-profit-testnet')&&page==='/'
  :unifiedPrimary==='single-capital-testnet'&&(page==='/'||page==='/hourly-test/'||page==='/hourly-test'));
 return Boolean(config?.unified)&&(daily?!hourly:hourly)&&primary==='verified-testnet'&&mode==='verified-isolated-testnet'&&
  (root||page===route||page===route.slice(0,-1));
}

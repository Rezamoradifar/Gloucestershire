// Route account actions without changing the default read-only unified preview.
// The caller must independently maintain its wallet-review and in-flight guard.
import {getAddress,isAddress,type Eip1193Provider} from 'ethers';
import {sendV3Action,sendV3TestTokenDeposit,sendV3UnifiedRegistration,sendV3UnifiedTestTokenDeposit,
 type ReviewApprovedDeposit,type V3TransactionProgressCallback} from './v3-actions';
import type {V3SiteReleaseConfig} from './v3-site-config';

type Input={provider:Eip1193Provider;wallet:string;referrer:string;config:V3SiteReleaseConfig|null;
 unifiedEnabled?:boolean;onProgress?:V3TransactionProgressCallback};
type Dependencies={register:typeof sendV3Action;deposit:typeof sendV3TestTokenDeposit;
 unifiedRegister:typeof sendV3UnifiedRegistration;unifiedDeposit:typeof sendV3UnifiedTestTokenDeposit};
const dependencies:Dependencies={register:sendV3Action,deposit:sendV3TestTokenDeposit,
 unifiedRegister:sendV3UnifiedRegistration,unifiedDeposit:sendV3UnifiedTestTokenDeposit};
function validate(input:Input){
 if(input.config?.unified&&input.unifiedEnabled!==true)throw Error('The unified testnet preview is read-only.');
 if(!input.config||!isAddress(input.wallet)||!isAddress(input.referrer))
  throw Error('Connect a valid wallet and check the testnet contract and referrer.');
 return {wallet:getAddress(input.wallet),referrer:getAddress(input.referrer),config:input.config};
}
export async function runV3Registration(input:Input,deps:Dependencies=dependencies){
 const {wallet,referrer,config}=validate(input);
 if(config.unified)return deps.unifiedRegister(input.provider,wallet,referrer,config,
  {enabled:true,onProgress:input.onProgress});
 return deps.register(input.provider,wallet,{kind:'register',referrer},config,input.onProgress);
}
export async function runV3Deposit(input:Input&{amount:bigint;reviewApprovedDeposit?:ReviewApprovedDeposit},deps:Dependencies=dependencies){
 const {wallet,referrer,config}=validate(input);
 if(typeof input.amount!=='bigint'||input.amount<=0n)throw Error('Enter a positive USDT amount.');
 if(config.unified)return deps.unifiedDeposit(input.provider,wallet,input.amount,referrer,config,
  {enabled:true,onProgress:input.onProgress,...(input.reviewApprovedDeposit?{reviewApprovedDeposit:input.reviewApprovedDeposit}:{})});
 return deps.deposit(input.provider,wallet,input.amount,referrer,config,input.onProgress);
}

// The default is deliberately read-only; enabling this flow requires an
// explicit release decision after the unified integration is complete.
import {getAddress,isAddress,type Eip1193Provider} from 'ethers';
import {sendV3UnifiedReinvestment,type V3TransactionProgressCallback} from './v3-actions';
import type {V3SiteReleaseConfig} from './v3-site-config';

type Input={enabled?:boolean;provider:Eip1193Provider;wallet:string;amount:bigint;
 config:V3SiteReleaseConfig|null;onProgress?:V3TransactionProgressCallback};
type Sender=typeof sendV3UnifiedReinvestment;
export async function runUnifiedReinvestment(input:Input,sender:Sender=sendV3UnifiedReinvestment){
 if(input.enabled!==true)throw Error('The unified testnet preview is read-only.');
 if(!input.config?.unified)throw Error('The verified unified testnet contract is required.');
 if(!isAddress(input.wallet)||typeof input.amount!=='bigint'||input.amount<=0n)
  throw Error('Connect a valid wallet and enter a positive USDT amount.');
 return sender(input.provider,getAddress(input.wallet),input.amount,input.config,input.onProgress);
}

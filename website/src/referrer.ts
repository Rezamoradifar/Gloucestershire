import {ZeroAddress} from 'ethers';
export function needsReferrerWarning(kind:string,registered:boolean,referrer=''){
 return kind==='deposit'&&!registered&&(!referrer.trim()||referrer.trim().toLowerCase()===ZeroAddress);
}

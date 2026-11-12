// The immutable vault records a referrer's public wallet address, not an
// arbitrary alphanumeric code. Invite links carry that exact address.
import {ZeroAddress,getAddress,isAddress} from 'ethers';

const officialHosts=new Set(['globaldroptrade.com','www.globaldroptrade.com']);
export type ReferralInvite={status:'absent'|'valid'|'invalid';address:string};

function address(value:string):string{
 const cleaned=value.trim();
 if(!isAddress(cleaned))throw Error('Enter a valid referral wallet address or invitation link.');
 const checked=getAddress(cleaned);
 if(checked===ZeroAddress)throw Error('The zero address cannot be a referrer.');
 return checked;
}

export function readReferralInvite(search:string):ReferralInvite{
 const params=new URLSearchParams(search);
 if(!params.has('ref'))return {status:'absent',address:''};
 if(params.getAll('ref').length!==1)return {status:'invalid',address:''};
 try{return {status:'valid',address:address(params.get('ref')||'')};}
 catch{return {status:'invalid',address:''};}
}

export function referralLink(wallet:string,origin:string,pathname='/'):string{
 const referrer=address(wallet);
 const parsed=new URL(origin);
 if(parsed.origin!==origin||!['http:','https:'].includes(parsed.protocol)||
  (parsed.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(parsed.hostname)))
  throw Error('The referral website origin is not supported.');
 const path=pathname.startsWith('/')&&pathname.startsWith('//')===false?pathname:'/';
 const url=new URL(path,parsed.origin);
 // No query tracking parameters or untrusted URLs are copied into invitations.
 url.search='';url.searchParams.set('ref',referrer);url.hash='dashboard';
 return url.href;
}

function sameApprovedWebsite(candidate:URL,expected:URL){
 if(candidate.origin===expected.origin)return true;
 return candidate.protocol==='https:'&&expected.protocol==='https:'&&
  officialHosts.has(candidate.hostname)&&officialHosts.has(expected.hostname)&&
  !candidate.port&&!expected.port;
}

// Accept either a wallet address or the official invitation URL pasted by the
// user. Never treat an unrelated website's query string as an on-chain referrer.
export function resolveReferralInput(value:string,origin:string):string{
 const input=value.trim();
 if(!input)return '';
 if(isAddress(input))return address(input);
 let invitation:URL;
 try{invitation=new URL(input);}catch{throw Error('Enter a valid referral wallet address or invitation link.');}
 const expected=new URL(origin);
 if(!sameApprovedWebsite(invitation,expected))throw Error('The invitation must come from this Global website.');
 const found=readReferralInvite(invitation.search);
 if(found.status!=='valid')throw Error('The invitation does not contain a valid referral address.');
 return found.address;
}

export function reviewReferralForDeposit(value:string,origin:string,investor:string):string{
 const referrer=resolveReferralInput(value,origin);
 if(referrer&&referrer.toLowerCase()===address(investor).toLowerCase())
  throw Error('You cannot use your own wallet address as your referrer.');
 return referrer;
}

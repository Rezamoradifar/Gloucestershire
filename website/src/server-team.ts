import {getAddress,isAddress} from 'ethers';
import {chainId,vaultAddress} from './config';

export type TeamMember={address:string;block:number;tx:string;index:number};
export type TeamPage={confirmedHead:number;members:TeamMember[];first:number|null;last:number|null};
export type TeamProfile={registered:boolean;active:boolean;kyc:boolean;capitalUsd:bigint;salesUsd:bigint;activeDirect:bigint;referrer:string};

const safe=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>=0;
const hex=(s:unknown)=>typeof s==='string'&&/^0x[0-9a-f]{64}$/i.test(s);
const fail=():never=>{throw Error('Verified team server returned inconsistent contract data. Retry.');};
async function getTeam(path:string,signal?:AbortSignal){
 let res:Response;
 try{res=await fetch(path,{cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000)});}
 catch(error){if((error as Error)?.name==='AbortError')throw error;throw Error('Team RPC is unreachable. Retry later.');}
 if(res.status===404)throw Error('Team API not installed. The API and website must be released together.');
 if(!res.ok)throw Error(res.status===400?'Invalid team request.':'Verified team RPC is temporarily unavailable.');
 return res.json() as Promise<Record<string,unknown>>;
}
const verified=(r:Record<string,unknown>)=>{
 if(r.version!==1||r.chainId!==chainId||!isAddress(r.vaultAddress)||getAddress(String(r.vaultAddress))!==getAddress(vaultAddress)||!safe(r.confirmedHead))fail();
};
export async function requestTeamPage(parent:string,from?:number,to?:number,signal?:AbortSignal):Promise<TeamPage>{
 if(!isAddress(parent))throw Error('Invalid referral wallet.');
 if((from===undefined)!==(to===undefined)||(from!==undefined&&(!safe(from)||!safe(to)||from>Number(to)||Number(to)-from+1>96)))throw Error('Invalid team range.');
 const params=new URLSearchParams({parent:getAddress(parent)});
 if(from!==undefined&&to!==undefined){params.set('from',String(from));params.set('to',String(to));}
 const r=await getTeam('/api/team/registrations?'+params,signal);
 verified(r);
 if(r.kind!=='registrations'||r.parent!==getAddress(parent)||!Array.isArray(r.members)||r.members.length>250)fail();
 if(from===undefined){if(r.first!==null||r.last!==null||r.members.length!==0)fail();}
 else if(r.first!==from||r.last!==to||Number(to)>Number(r.confirmedHead))fail();
 const seen=new Set<string>();
 for(const item of r.members){
  if(!item||typeof item!=='object')fail();
  const row=item as Record<string,unknown>;
  if(!isAddress(row.address)||!safe(row.block)||!safe(row.index)||!hex(row.tx)||
    from===undefined||to===undefined||Number(row.block)<from||Number(row.block)>to)fail();
  const id=row.tx+':'+row.index;
  if(seen.has(id))fail();seen.add(id);
 }
 return {confirmedHead:Number(r.confirmedHead),first:r.first as number|null,last:r.last as number|null,
  members:r.members as TeamMember[]};
}
export async function requestTeamProfile(wallet:string,block?:number,signal?:AbortSignal):Promise<TeamProfile>{
 if(!isAddress(wallet)||(block!==undefined&&!safe(block)))throw Error('Invalid team member request.');
 const params=new URLSearchParams({wallet:getAddress(wallet)});
 if(block!==undefined)params.set('block',String(block));
 const r=await getTeam('/api/team/member?'+params,signal);
 verified(r);
 if(r.kind!=='member'||r.wallet!==getAddress(wallet)||!safe(r.block)||(block!==undefined&&r.block!==block)||Number(r.block)>Number(r.confirmedHead)||
    !r.profile||typeof r.profile!=='object')fail();
 const profile=r.profile as Record<string,unknown>;
 if(!isAddress(profile.referrer)||typeof profile.registered!=='boolean'||typeof profile.active!=='boolean'||
    typeof profile.kyc!=='boolean'||!['activeDirect','capitalUsd','salesUsd'].every(k=>typeof profile[k]==='string'&&/^(0|[1-9][0-9]*)$/.test(profile[k] as string)))fail();
 return {referrer:profile.referrer as string,registered:profile.registered,active:profile.active,kyc:profile.kyc,
  activeDirect:BigInt(profile.activeDirect as string),capitalUsd:BigInt(profile.capitalUsd as string),salesUsd:BigInt(profile.salesUsd as string)};
}

export type VerifiedLevelVolume={level:number;members:number;volume:bigint};
export async function requestTeamVolumes(wallet:string,block?:number,signal?:AbortSignal):Promise<{block:number;levels:VerifiedLevelVolume[]}>{
 if(!isAddress(wallet)||(block!==undefined&&!safe(block)))throw Error('Invalid team volume request.');
 const params=new URLSearchParams({wallet:getAddress(wallet)});
 if(block!==undefined)params.set('block',String(block));
 const r=await getTeam('/api/team/volume?'+params,signal);
 verified(r);
 if(r.kind!=='volume'||r.wallet!==getAddress(wallet)||!safe(r.block)||
    Number(r.block)>Number(r.confirmedHead)||(block!==undefined&&r.block!==block)||
    !Array.isArray(r.levels)||r.levels.length!==3)fail();
 const levels=r.levels.map((entry,index)=>{
  if(!entry||typeof entry!=='object')fail();
  const row=entry as Record<string,unknown>;
  if(row.level!==index+1||!safe(row.members)||typeof row.volume!=='string'||
    !/^(0|[1-9][0-9]*)$/.test(row.volume))fail();
  return {level:index+1,members:Number(row.members),volume:BigInt(row.volume)};
 });
 return {block:Number(r.block),levels};
}

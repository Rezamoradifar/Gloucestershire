import {getAddress,isAddress,ZeroAddress} from 'ethers';
import {chainId,vaultAddress} from './config';

export type VerifiedTeamMember={
 wallet:string;blockNumber:number;blockHash:string;registered:boolean;active:boolean;kyc:boolean;
 referrer:string;activeDirect:bigint;capitalUsd:bigint;salesUsd:bigint;
};
const uint=(value:unknown):value is string=>typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value)&&value.length<80;
const validHash=(value:unknown)=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);
function fail():never{throw Error('The team profile could not be verified against the configured contract. Retry.');}

export function parseVerifiedTeamMember(value:unknown,wallet:string):VerifiedTeamMember{
 if(!value||typeof value!=='object'||Array.isArray(value)||!isAddress(wallet))fail();
 const row=value as Record<string,unknown>;
 if(row.version!==1||row.chainId!==chainId||!isAddress(String(row.vaultAddress))||
  getAddress(String(row.vaultAddress))!==getAddress(vaultAddress)||
  !isAddress(String(row.wallet))||getAddress(String(row.wallet))!==getAddress(wallet)||
  !isAddress(String(row.referrer))||row.source!=='contract+rpc'||
  !Number.isSafeInteger(row.blockNumber)||Number(row.blockNumber)<0||!validHash(row.blockHash)||
  typeof row.registered!=='boolean'||typeof row.active!=='boolean'||typeof row.kyc!=='boolean'||
  !uint(row.activeDirect)||!uint(row.capitalUsd)||!uint(row.salesUsd))fail();
 return {
  wallet:getAddress(String(row.wallet)),referrer:getAddress(String(row.referrer)),
  blockNumber:Number(row.blockNumber),blockHash:String(row.blockHash),
  registered:row.registered as boolean,active:row.active as boolean,kyc:row.kyc as boolean,
  activeDirect:BigInt(row.activeDirect as string),capitalUsd:BigInt(row.capitalUsd as string),
  salesUsd:BigInt(row.salesUsd as string)
 };
}
export async function requestVerifiedTeamMember(wallet:string,fetcher:typeof fetch=fetch):Promise<VerifiedTeamMember>{
 if(!isAddress(wallet)||getAddress(wallet)===ZeroAddress)fail();
 let response:Response;
 try{
  response=await fetcher('/api/team/member?wallet='+encodeURIComponent(getAddress(wallet)),{
   cache:'no-store',signal:AbortSignal.timeout(15000)
  });
 }catch{throw Error('The server contract RPC is unavailable. Retry the team profile.');}
 if(!response.ok)throw Error('The team profile RPC is temporarily unavailable. No unverified status was substituted.');
 return parseVerifiedTeamMember(await response.json(),wallet);
}

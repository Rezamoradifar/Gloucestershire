import {getAddress,toQuantity,type Eip1193Provider} from 'ethers';
import {v3ReadSession,V3_INDEPENDENT_READER_COUNT} from './v3-chain';
import type {V3SiteReleaseConfig} from './v3-site-config';

export type TeamMember={wallet:string;referrer:string;level:number;eligible:boolean;suspended:boolean;capital:bigint;rateBps:number|null};
type TeamChunk={block:number;total:number;scanned:number;members:TeamMember[]};

// The vault requires a parent to be registered before its child. Registry order
// therefore resolves every generation even when a parent was on an earlier page.
export async function readV3TeamDirectory(walletProvider:Eip1193Provider,config:V3SiteReleaseConfig,
 wallet:string,signal:AbortSignal,onChunk:(chunk:TeamChunk)=>void){
 const root=getAddress(wallet);
 const depths=new Map<string,number>([[root,0]]);
 let anchor:{block:number;hash:string;total:number}|undefined;
 const rateTable=new Map<string,number>();
 let scanned=0,reader=0;
 while(reader<V3_INDEPENDENT_READER_COUNT){
  signal.throwIfAborted();
  const session=await v3ReadSession(walletProvider,root,config,true,reader);
  try{
   signal.throwIfAborted();
   const block=anchor?.block??session.block.number;
   const options={blockTag:block};
   const total=Number(await session.vault.memberCount(options));
   if(!Number.isSafeInteger(total)||total<0||total>1000000)throw Error('Invalid team registry size.');
   if(!anchor){
    if(!session.block.hash)throw Error('Missing team snapshot hash.');
    anchor={block,hash:session.block.hash,total};
   }
   const expected=anchor;
   const checkAnchor=async()=>{
    signal.throwIfAborted();
    const current=await session.provider.send('eth_getBlockByNumber',[toQuantity(block),false]);
    if(!current?.hash||current.hash.toLowerCase()!==expected.hash.toLowerCase())throw Error('Team snapshot block changed.');
   };
   await checkAnchor();
   if(total!==expected.total)throw Error('Team registry size changed.');
   if(!scanned)onChunk({scanned:0,block,total,members:[]});
   while(scanned<total){
    signal.throwIfAborted();
    const size=Math.min(8,total-scanned);
    const rows=await Promise.all(Array.from({length:size},async(_,offset)=>{
     const wallet=getAddress(await session.vault.memberAt(scanned+offset,options));
     const user=await session.vault.users(wallet,options);
     if(!user.registered)throw Error('Invalid registered team member.');
     return {wallet,referrer:getAddress(user.referrer),capital:BigInt(user.capital),suspended:Boolean(user.suspended)};
    }));
    const nextDepths=new Map<string,number>();
    const descendants=rows.flatMap(row=>{
     const parent=nextDepths.get(row.referrer)??depths.get(row.referrer);
     if(row.wallet===root||parent===undefined)return [];
     const level=parent+1;
     nextDepths.set(row.wallet,level);
     return [{...row,level}];
    });
    const members=await Promise.all(descendants.map(async row=>{
     const eligible=Boolean(await session.vault.isEligible(row.wallet,options));
     let rateBps:number|null=0;
     if(row.level<=4){
      try{
       let tableKey:string|undefined;
       if(config.unified?.uplineRates){
        rateBps=Number(await session.vault.currentReferralBps(row.wallet,row.level,options));
       }else{
        const tier=Number(await session.vault.tierOf(row.wallet,options));
        tableKey=tier+':'+row.level;
        rateBps=rateTable.get(tableKey)??Number(await session.vault.referralBps(tier,row.level-1,options));
       }
       if(!Number.isInteger(rateBps)||rateBps<0||rateBps>10000)throw Error('Invalid referral rate.');
       if(tableKey)rateTable.set(tableKey,rateBps);
      }catch{rateBps=null;}
     }
     return {...row,eligible,rateBps};
    }));
    await checkAnchor();
    signal.throwIfAborted();
    for(const [wallet,level] of nextDepths)depths.set(wallet,level);
    scanned+=size;onChunk({scanned,members,block,total});
   }
   return;
  }catch(error){
   signal.throwIfAborted();
   reader=session.readerIndex+1;
   if(reader>=V3_INDEPENDENT_READER_COUNT)throw error;
  }finally{session.provider.destroy();}
 }
}

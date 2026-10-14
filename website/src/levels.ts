import type {Contract} from 'ethers';
const LIMIT=4096,CONCURRENCY=6;
const key=(s:string)=>s.toLowerCase();
export async function mapBounded<T,R>(items:T[],fn:(item:T)=>Promise<R>,signal?:AbortSignal):Promise<R[]>{
 const result:R[]=new Array(items.length);let cursor=0;
 await Promise.all(Array.from({length:Math.min(CONCURRENCY,items.length)},async()=>{while(cursor<items.length){if(signal?.aborted)throw Error('Read cancelled.');const i=cursor++;result[i]=await fn(items[i]);}}));return result;
}
export type LevelVolume={level:number;members:number;volume:bigint};
export async function readLevelVolumes(vault:Contract,who:string,block:number,progress:(s:string)=>void=()=>{},signal?:AbortSignal):Promise<LevelVolume[]>{
 const options={blockTag:block},seen=new Set([key(who)]),subtrees=[0n,0n,0n,0n],members=[0,0,0];
 const jobs=Number(await vault.volumeJobCount(options));
 if(jobs>LIMIT)throw Error('This history needs a server index for complete level totals. No partial total is shown.');
 for(let start=0;start<jobs;start+=64){
  progress(`Checking confirmed volume propagation ${Math.min(start+64,jobs)} / ${jobs}…`);
  const page=await mapBounded(Array.from({length:Math.min(64,jobs-start)},(_,i)=>start+i),i=>vault.volumeJobs(i,options),signal);
  if(page.some(job=>!/^0x0{40}$/i.test(job.ancestor)))throw Error('Some network volume is still waiting for on-chain propagation. Finish processing it before loading exact level totals.');
 }
 let parents=[who],total=0;
 for(let depth=0;depth<4;depth++){
  progress(`Reading level ${depth+1} branch volumes…`);
  const counts=await mapBounded(parents,async parent=>({parent,count:Number(await vault.networkBranchCount(parent,options))}),signal);
  const size=counts.reduce((n,x)=>n+x.count,0);total+=size;if(total>LIMIT)throw Error('This network needs a server index for complete level totals. No partial total is shown.');
  const reads=counts.flatMap(({parent,count})=>Array.from({length:count},(_,i)=>({parent,i})));
  const edges=await mapBounded(reads,async({parent,i})=>{const child=String(await vault.networkBranch(parent,i,options));return {child,volume:BigInt(await vault.branchVolumeUsd(parent,child,options))};},signal);
  for(const edge of edges){if(seen.has(key(edge.child)))throw Error('Unexpected duplicate referral member.');seen.add(key(edge.child));subtrees[depth]+=edge.volume;}
  if(depth<3)members[depth]=edges.length;parents=edges.map(edge=>edge.child);
 }
 if(subtrees.some((n,i)=>i<3&&n<subtrees[i+1]))throw Error('Inconsistent network snapshot. Refresh before loading level totals.');
 return members.map((count,i)=>({level:i+1,members:count,volume:subtrees[i]-subtrees[i+1]}));
}

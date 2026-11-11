import type {BrowserProvider,Log} from 'ethers';

type EventFilter={address:string;topics:(string|string[]|null)[]};
/** Query a bounded canonical block window, shrinking on RPC range limits.
 * One-block failure is reported clearly rather than looping or inventing a zero history. */
export async function readEventPage(provider:BrowserProvider,filter:EventFilter,minimum:number,maximum:number,preferredSpan=64):Promise<{logs:Log[];first:number}>{
 if(!Number.isSafeInteger(minimum)||!Number.isSafeInteger(maximum)||minimum<0||maximum<minimum)throw Error('Invalid history block window.');
 let span=Math.min(Math.max(1,preferredSpan),maximum-minimum+1);
 while(true){
  const first=Math.max(minimum,maximum-span+1);
  try{
   const logs=await provider.getLogs({address:filter.address,topics:filter.topics,fromBlock:first,toBlock:maximum});
   return {logs,first};
  }catch(error){
   if(span===1)throw Error('Historical events are unavailable from this wallet RPC. Use an RPC with eth_getLogs support or try again later.',{cause:error});
   span=Math.max(1,Math.floor(span/2));
  }
 }
}

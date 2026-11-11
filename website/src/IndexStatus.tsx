import type {AllocationStatus} from './daily-activity-client';

const block=(value:number|null)=>value===null?'Not reported':value.toLocaleString('en-US');
export default function IndexStatus({allocation}:{allocation:AllocationStatus|null}){
 const progress=allocation?.indexProgress;
 if(!progress)return null;
 const latestBlock=allocation.lastCredit?.batches.reduce((max,row)=>Math.max(max,row.block),0);
 const state=allocation.dailyStatus==='indexing'?'Indexing':allocation.dailyStatus==='ready'||allocation.dailyStatus==='not_due'?'Ready':allocation.dailyStatus==='waiting'?'Waiting':'Not reported';
 const remaining=(through:number|null)=>through===null||progress.target===null||through>progress.target?null:progress.target-through;
 return <section className="daily-index" aria-label="Index status">
  <h3>Index status</h3>
  <p>{allocation.fresh?'Latest worker report':'Previous worker report; update pending'}{allocation.checkedAt?' · checked '+new Date(allocation.checkedAt).toLocaleString('en-US'):''}</p>
  <div className="plan-detail"><span>Last worker status</span><strong>{state}</strong></div>
  <div className="plan-detail"><span>Members indexed through block</span><strong>{block(progress.memberThrough)}</strong></div>
  <div className="plan-detail"><span>Positions indexed through block</span><strong>{block(progress.positionThrough)}</strong></div>
  <div className="plan-detail"><span>Worker index target block</span><strong>{block(progress.target)}</strong></div>
  <div className="plan-detail"><span>Blocks remaining to recorded target: members / positions</span><strong>{block(remaining(progress.memberThrough))} / {block(remaining(progress.positionThrough))}</strong></div>
  <div className="plan-detail"><span>Indexed members / positions</span><strong>{block(progress.memberCount)} / {block(progress.positionCount)}</strong></div>
  <p className="muted">The target is the worker's recorded scan target, not the current chain head. A completed index does not confirm a reward payment.</p>
  <p className="muted">{latestBlock?'Last reported confirmed system allocation was in block '+latestBlock.toLocaleString('en-US')+(allocation.lastCreditBlockTimestamp?' · block time '+new Date(allocation.lastCreditBlockTimestamp*1000).toLocaleString('en-US'):'')+'.':'No confirmed allocation is reported.'}</p>
 </section>;
}

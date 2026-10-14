import {useEffect,useState} from 'react';
import {session,errorText} from './chain';
import {displayAmount as fmt} from './money';
import {readRankEligibility,type RankEligibility} from './rank';
export default function PlanEligibility({who,block,tier,activeDirect}:{who:string;block:number;tier:number;activeDirect:bigint}){
 const [data,setData]=useState<RankEligibility|null>(null),[error,setError]=useState('');
 useEffect(()=>{let stopped=false;setData(null);setError('');(async()=>{try{const {vault}=await session(who);const result=await readRankEligibility(vault,who,tier,block);if(!stopped)setData(result);}catch(e){if(!stopped)setError(errorText(e));}})();return()=>{stopped=true;};},[who,block,tier]);
 return <div aria-live="polite"><div className="plan-detail"><span>Capital-qualified directs</span><strong>{data?`${data.qualified} / ${data.requiredDirect}`:'Loading…'}</strong></div><p className="muted">Each qualifying direct needs at least {data?fmt(data.minimum,18,2):'—'} USD in current capital.</p><div className="plan-detail"><span>Reporter-verified active directs</span><strong>{activeDirect.toString()}</strong></div>{data&&<><div className="plan-detail"><span>Eligible rank volume</span><bdi>{fmt(data.volume,18,2)} / {fmt(data.target,18,2)} USD</bdi></div><p className="muted">{data.missing>0n?`${fmt(data.missing,18,2)} USD more eligible volume needed. `:'Volume requirement met. '}{data.qualified<data.requiredDirect?`${data.requiredDirect-data.qualified} more qualifying directs needed. `:''}Each branch counts up to {Number(data.cap)/100}% ({fmt(data.target*data.cap/10000n,18,2)} USD). Daily targets do not automatically credit profit.</p></>}{error&&<p className="inline-error" role="alert">Rank details unavailable: {error}</p>}</div>;
}

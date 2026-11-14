import {useEffect,useRef,useState} from 'react';
import DigitalValue from './DigitalValue';
import {formatV3Amount} from './v3-format';

type Snapshot={value:bigint;block:number};
type Direction='up'|'down';

// Compare exact verified values, but signal only changes visible at the
// displayed precision. Never infer intervening values or extrapolate profit.
export function v3ClaimDirection(previous:Snapshot|null,current:Snapshot):Direction|null{
 if(!previous||current.block<=previous.block||
    formatV3Amount(previous.value)===formatV3Amount(current.value))return null;
 return current.value>previous.value?'up':current.value<previous.value?'down':null;
}

// A delayed or conflicting snapshot makes the sequence ambiguous. Reset the
// baseline so the next observation cannot be compared against a stale display.
export function v3NextClaimSnapshot(previous:Snapshot|null,current:Snapshot):Snapshot|null{
 if(previous&&(current.block<previous.block||
   (current.block===previous.block&&current.value!==previous.value)))return null;
 return current;
}

export default function V3ClaimValue({value,block,size='card'}:{
 value:bigint;block:number;size?:'card'|'hero';
}){
 const previous=useRef<Snapshot|null>(null);
 const [signal,setSignal]=useState<{direction:Direction;revision:number}|null>(null);
 const revision=useRef(0);
 const formatted=formatV3Amount(value);
 useEffect(()=>{
  const current={value,block};
  const direction=v3ClaimDirection(previous.current,current);
  previous.current=v3NextClaimSnapshot(previous.current,current);
  if(!direction){setSignal(null);return;}
  setSignal({direction,revision:++revision.current});
  const timer=window.setTimeout(()=>setSignal(null),2500);
  return()=>window.clearTimeout(timer);
 },[value,block]);
 const directionText=signal?.direction==='up'?'increased':signal?.direction==='down'?'decreased':'';
 return <span className={'gv3-claim-value'+(signal?' gv3-claim-value--'+signal.direction:'')}>
  <span key={signal?.revision??0} className="gv3-claim-value-pulse">
   <DigitalValue value={formatted} unit="TEST USDT" size={size}
    label={formatted+' TEST USDT'+(directionText?' · '+directionText:'')}/>
  </span>
  {signal&&<span className="gv3-claim-direction" aria-hidden="true">{signal.direction==='up'?'↑':'↓'}</span>}
 </span>;
}

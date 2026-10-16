import {useEffect,useRef,useState} from 'react';
import {Pause,Play} from 'lucide-react';
export default function DepthMotion(){
 const [paused,setPaused]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches);
 const control=useRef<HTMLButtonElement>(null);
 useEffect(()=>{const media=window.matchMedia('(prefers-reduced-motion: reduce)');const change=()=>setPaused(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
 useEffect(()=>{
  const root=control.current?.closest('.gdt-page') as HTMLElement|null;if(!root)return;
  root.dataset.motion=paused?'paused':'active';
  if(paused||!window.matchMedia('(hover: hover) and (pointer: fine)').matches)return;
  let active:HTMLElement|null=null,frame=0;
  const reset=()=>{cancelAnimationFrame(frame);if(active){active.style.removeProperty('--rx');active.style.removeProperty('--ry');active=null;}};
  const move=(e:PointerEvent)=>{
   const card=(e.target as Element).closest<HTMLElement>('[data-depth]');
   if(card!==active)reset();if(!card)return;active=card;
   const rect=card.getBoundingClientRect(),x=(e.clientX-rect.left)/rect.width-.5,y=(e.clientY-rect.top)/rect.height-.5;
   cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{card.style.setProperty('--rx',`${-y*6}deg`);card.style.setProperty('--ry',`${x*8}deg`);});
  };
  root.addEventListener('pointermove',move,{passive:true});root.addEventListener('pointerleave',reset);
  return()=>{reset();root.removeEventListener('pointermove',move);root.removeEventListener('pointerleave',reset);};
 },[paused]);
 return <button ref={control} className="gdt-motion-control" aria-pressed={paused} onClick={()=>setPaused(!paused)}>{paused?<Play size={14}/>:<Pause size={14}/>} {paused?'Enable motion':'Pause motion'}</button>;
}

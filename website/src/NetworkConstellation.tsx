import {GitBranch} from 'lucide-react';
type Member={address:string};
type Node={member:Member;x:number;y:number};
const short=(s:string)=>s.slice(0,6)+'…'+s.slice(-4);
/** Interactive visual sample; the expandable referral list remains the complete view of loaded members. */
export default function NetworkConstellation({parent,members,selected,onSelect}:{parent:string;members:Member[];selected:string|null;onSelect:(wallet:string)=>void}){
 const nodes:Node[]=members.slice(0,9).map((member,i,visible)=>{
  const theta=-Math.PI/2+(Math.PI*2*i)/visible.length;
  return {member,x:50+35*Math.cos(theta),y:50+33*Math.sin(theta)};
 });
 if(nodes.length===0)return null;
 return <div className="v2-constellation" aria-label="Interactive preview of registered direct referrals">
  <div className="v2-constellation-heading"><span><GitBranch size={17}/> Network constellation</span><small>{nodes.length} of {members.length} loaded direct registrations shown · select a node for details</small></div>
  <div className="v2-constellation-space">
   <div className="v2-constellation-orbit v2-orbit-first" aria-hidden="true"/>
   <div className="v2-constellation-orbit v2-orbit-second" aria-hidden="true"/>
   <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{nodes.map(n=><line key={n.member.address} x1="50" y1="50" x2={n.x} y2={n.y} stroke="currentColor" strokeWidth=".24" strokeDasharray="1 1.4"/>)}</svg>
   <div className="v2-constellation-center"><span>◎</span><strong>Your team</strong><small>{short(parent)}</small></div>
   {nodes.map((node,i)=><button type="button" key={node.member.address} className={'v2-constellation-node '+(selected?.toLowerCase()===node.member.address.toLowerCase()?'active':'')} onClick={()=>onSelect(node.member.address)} style={{left:node.x+'%',top:node.y+'%'}} aria-label={'View registered direct '+short(node.member.address)} aria-pressed={selected?.toLowerCase()===node.member.address.toLowerCase()}><span>{String(i+1).padStart(2,'0')}</span><small>{short(node.member.address)}</small></button>)}
  </div>
  <p>Visualization uses canonical contract referral membership, not a wallet log scan. Node position and glow are decorative, not financial performance or member activity indicators.</p>
 </div>;
}

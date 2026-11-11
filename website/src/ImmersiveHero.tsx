import {ArrowDown,ArrowRight,ArrowUpRight,Layers3,ScanLine,ShieldCheck,Sparkles} from 'lucide-react';
import DepthMotion from './DepthMotion';

const pillars=[
 {number:'01',name:'RESEARCH',Icon:ScanLine,title:'Intelligence',accent:'across borders.',description:'Explore the intended AI-assisted market research workflow, from demand signals to human validation.',href:'#our-ai',link:'Explore the workflow'},
 {number:'02',name:'COMMERCE',Icon:Layers3,title:'Commerce',accent:'without boundaries.',description:'Discover the proposed combination of dropshipping, market comparison and global sourcing.',href:'#how-it-works',link:'See how it works'},
 {number:'03',name:'WORKSPACE',Icon:ShieldCheck,title:'Clarity',accent:'on the record.',description:'Connect your wallet to review actual contract balances, registered activity and withdrawal conditions.',href:'#dashboard',link:'Open the dashboard'}
];

export default function ImmersiveHero(){
 return <>
  <section className="gdt-hero v3-hero" aria-labelledby="hero-title" data-landing-release="global-immersive-v3">
   <div className="v3-hero-atmosphere" aria-hidden="true"/>
   <div className="gdt-wrap v3-hero-layout">
    <div className="v3-hero-copy">
     <div className="v3-status-kicker"><span className="v3-status-light"/> GLOBAL DROP TRADE <i/> A NEW DIGITAL PERSPECTIVE</div>
     <h1 id="hero-title">The world is<br/><span>full of</span> <em>possibility.</em></h1>
     <p className="v3-hero-lead">From worldwide product discovery to an account you can verify on-chain. Explore a more connected vision of commerce, technology and intelligent market research.</p>
     <div className="v3-hero-actions">
      <a href="#dashboard" className="v3-action-primary">Explore dashboard <ArrowUpRight size={19}/></a>
      <a className="v3-action-secondary" href="#how-it-works"><span><ArrowRight size={18}/></span> Discover the model</a>
     </div>
     <div className="v3-hero-highlights" aria-label="Platform focus">
      <div><ScanLine size={20}/><span><strong>MARKET DISCOVERY</strong><small>Research-driven exploration</small></span></div>
      <div><Layers3 size={20}/><span><strong>CONNECTED COMMERCE</strong><small>Dropshipping & arbitrage</small></span></div>
      <div><ShieldCheck size={20}/><span><strong>ON-CHAIN RECORDS</strong><small>Verify recorded events</small></span></div>
     </div>
     <DepthMotion/>
     <div className="v3-hero-disclaimer"><span>CONCEPT VISUALS</span><i/> Commerce integrations are illustrative; real contract records are available after wallet connection.</div>
    </div>
    <div className="v3-hero-art" aria-label="Conceptual three-dimensional Earth and global market intelligence">
     <div className="v3-hero-art-grid" aria-hidden="true"/>
     <div className="v3-world-ring v3-ring-outer" aria-hidden="true"/>
     <div className="v3-world-ring v3-ring-inner" aria-hidden="true"/>
     <div className="v3-world-halo" aria-hidden="true"/>
     <figure className="v3-world-figure">
      <img src="/assets/intelligence-earth-1280.webp" alt="Conceptual illuminated Earth with global market connections" fetchPriority="high" width="1280" height="1280"/>
      <figcaption>GLOBAL COMMERCE / VISUAL CONCEPT</figcaption>
     </figure>
     <div className="v3-world-orbit-dot v3-dot-one" aria-hidden="true"/>
     <div className="v3-world-orbit-dot v3-dot-two" aria-hidden="true"/>
     <div className="v3-world-orbit-dot v3-dot-three" aria-hidden="true"/>
     <div className="v3-floating-panel v3-floating-intelligence">
      <div className="v3-panel-symbol"><Sparkles size={22}/></div>
      <div><span>GLOBAL INTELLIGENCE</span><strong>See a wider market</strong><small>Concept workflow</small></div>
     </div>
     <div className="v3-floating-panel v3-floating-transparent">
      <div className="v3-panel-symbol"><ShieldCheck size={22}/></div>
      <div><span>SMART CONTRACT PLATFORM</span><strong>Publicly verifiable data</strong><small>Wallet connection required</small></div>
     </div>
     <div className="v3-art-coordinates" aria-hidden="true">GDT / 01 — CONNECTED WORLD</div>
    </div>
   </div>
   <div className="v3-hero-bottom">
    <div className="gdt-wrap v3-bottom-inner">
     <div><span>GLOBAL PERSPECTIVE</span><i/><span>HUMAN EXPERIENCE</span><i/><span>INTELLIGENT WORKFLOWS</span></div>
     <a href="#capabilities">SCROLL TO EXPLORE <ArrowDown size={16}/></a>
    </div>
   </div>
  </section>
  <section className="gdt-wrap v3-capabilities" id="capabilities" aria-labelledby="v3-capabilities-heading">
   <div className="v3-capabilities-intro">
    <div><span className="v3-capabilities-kicker">BEYOND A DASHBOARD</span><h2 id="v3-capabilities-heading">One vision. <em>Three dimensions.</em></h2></div>
    <p>From research and commerce concepts to a connected account workspace. We distinguish envisioned workflows from the contract information available now.</p>
   </div>
   <div className="v3-capability-grid">
    {pillars.map(({number,name,Icon,title,accent,description,href,link})=><a key={number} href={href} className={'v3-capability-card v3-card-'+number}>
     <div className="v3-card-backdrop" aria-hidden="true"><span/><span/><span/></div>
     <div className="v3-capability-top"><span>{number} / {name}</span><Icon size={24}/></div>
     <div><h3>{title}<br/><em>{accent}</em></h3><p>{description}</p></div>
     <span className="v3-card-link">{link} <ArrowUpRight size={17}/></span>
    </a>)}
   </div>
  </section>
 </>;
}

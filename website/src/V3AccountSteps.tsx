import {ArrowUpRight,Clock3,Layers,ShieldCheck,Wallet} from 'lucide-react';
import './v3-account-steps.css';

const steps=[
 {Icon:Wallet,title:'Connect your wallet',copy:'Select BNB Testnet and connect the wallet you want to use with the verified V3 contract.'},
 {Icon:Layers,title:'Open a position',copy:'Approve and deposit actual test tokens from that wallet. The contract records the position and its routing on chain.'},
 {Icon:Clock3,title:'Follow your daily cycle',copy:'Check in on chain. Eligible daily and profit-on-profit claims are recorded by a user or an operating, funded keeper.'},
 {Icon:ShieldCheck,title:'Request and verify payment',copy:'Request an available claim. Approval, test-token funding and the confirmed payment are separate steps.'}
];

export default function V3AccountSteps(){
 return <section className="gdt-wrap gdt-section v3-account-steps" id="in-action" aria-labelledby="v3-account-steps-title">
  <div className="gdt-section-top"><div className="gdt-eyebrow"><span/>YOUR CONTRACT WORKSPACE</div>
   <span className="gdt-section-number">02 / ACCOUNT OPERATIONS</span></div>
  <div className="gdt-split"><h2 id="v3-account-steps-title">Your account.<br/><em>Recorded on chain.</em></h2>
   <p>Connect your wallet to use the current contract and inspect your own confirmed activity. The workspace uses BNB Testnet and test USDT with no monetary value.</p></div>
  <div className="gdt-human-steps">{steps.map(({Icon,title,copy},i)=><article key={title}>
   <span>0{i+1}</span><Icon size={21}/><h3>{title}</h3><p>{copy}</p>
  </article>)}</div>
  <a className="gdt-button" href="#dashboard">Open your account <ArrowUpRight size={17}/></a>
 </section>;
}

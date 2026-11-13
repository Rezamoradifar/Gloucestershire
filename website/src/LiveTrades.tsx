import {ExternalLink,ShieldCheck,Clock3} from 'lucide-react';
import {V2_ADDRESS,V2_EXPLORER} from './v2-chain';

// The landing page intentionally never loads old /api/trades settlements.
// Only V2 is linked. A history index is not yet installed, so do not invent
// customer activity, profit or settlement records.
export default function LiveTrades(){
 return <section className="gdt-wrap gdt-section gdt-trades" id="transactions" aria-labelledby="trades-title">
  <div className="gdt-section-top"><div className="gdt-eyebrow"><span/>V2 ON-CHAIN TRANSPARENCY</div>
   <span className="gdt-feed-status" role="status">BNB TESTNET · CONTRACT VERIFIED</span></div>
  <div className="gdt-split"><h2 id="trades-title">New contract.<br/><em>Verifiable by anyone.</em></h2>
   <p>Global V2 is a separate testnet prototype. The new vault has no imported customer balances or financial history from prior versions. On-chain records are public, while a complete verified event explorer is still being built.</p>
  </div>
  <div className="gdt-trade-panel"><div className="gdt-trade-empty">
   <ShieldCheck size={26} aria-hidden="true"/>
   <span className="gdt-overline">GLOBAL V2 · CHAIN 97</span>
   <h3>Read the deployed contract on BscScan Testnet.</h3>
   <p style={{overflowWrap:'anywhere'}}>{V2_ADDRESS}</p>
   <a href={V2_EXPLORER+'/address/'+V2_ADDRESS} target="_blank" rel="noopener noreferrer">
    Open verified address <ExternalLink size={15}/>
   </a>
  </div></div>
  <div className="gdt-trade-foot"><Clock3 size={16}/><span>Historical V2 financial-event indexing is pending. No customer profits or deposits are claimed by this panel.</span></div>
 </section>;
}

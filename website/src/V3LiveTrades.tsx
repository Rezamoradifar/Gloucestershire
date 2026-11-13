import {Clock3,ExternalLink,ShieldCheck} from 'lucide-react';
import {v3ParseReleaseConfig} from './v3-site-config';

// The installer supplies these public identifiers only after its testnet
// deployment proof and runtime checks pass. No sample address is substituted.
const release=v3ParseReleaseConfig({
 address:import.meta.env.VITE_V3_CONTRACT_ADDRESS,
 runtimeHash:import.meta.env.VITE_V3_RUNTIME_HASH,
 deploymentTx:import.meta.env.VITE_V3_DEPLOYMENT_TX
});
export default function V3LiveTrades(){
 return <section className="gdt-wrap gdt-section gdt-trades" id="transactions" aria-labelledby="trades-title">
  <div className="gdt-section-top"><div className="gdt-eyebrow"><span/>TESTNET TRANSPARENCY</div>
   <span className="gdt-feed-status" role="status">BNB TESTNET · CHAIN 97</span></div>
  <div className="gdt-split"><h2 id="trades-title">Current contract.<br/><em>Open to review.</em></h2>
   <p>This isolated test environment uses mock tokens. Connect a wallet in the dashboard to verify the contract and read its actual account records.</p></div>
  <div className="gdt-trade-panel"><div className="gdt-trade-empty"><ShieldCheck size={26} aria-hidden="true"/>
   <span className="gdt-overline">GLOBAL V3 · CHAIN 97</span>
   {release?<><h3>Review the configured test contract.</h3>
    <p style={{overflowWrap:'anywhere'}}>{release.address}</p>
    <a href={'https://testnet.bscscan.com/address/'+release.address} target="_blank" rel="noopener noreferrer">Open on BscScan Testnet <ExternalLink size={15}/></a></>:
    <><h3>Contract configuration is not available.</h3><p>A verified release is required before account data can be shown.</p></>}
  </div></div>
  <div className="gdt-trade-foot"><Clock3 size={16}/><span>A complete event explorer is not available. This panel does not claim deposits or profits.</span></div>
 </section>;
}

import {ExternalLink,GitBranch} from 'lucide-react';
import {V3_DEPOSIT_FEE_1,V3_DEPOSIT_FEE_2,V3_OPERATIONS,V3_EXPLORER} from './v3-chain';

const destinations=[
 {label:'Original fee wallet 1',percent:'10%',address:V3_DEPOSIT_FEE_1},
 {label:'Original fee wallet 2',percent:'10%',address:V3_DEPOSIT_FEE_2},
 {label:'Original operations wallet',percent:'80%',address:V3_OPERATIONS}
];
export default function V3PaymentMap(){
 return <section className="gv3-payment-map" aria-label="Test deposit and withdrawal payment map">
  <div className="gv3-payment-heading"><div><span className="gv3-kicker">PAYMENT ROUTING</span><h2>Where test deposits go</h2></div><GitBranch size={21}/></div>
  <p>Each external MOCK token deposit routes to the original fixed destinations. The full deposit is recorded as principal; it is not retained as vault cash. Rounding goes to operations.</p>
  <div className="gv3-routing-bar" aria-hidden="true"><span/><span/><span/></div>
  <div className="gv3-routing-list">{destinations.map(item=><div key={item.address}>
   <span className="gv3-routing-percent">{item.percent}</span><div><strong>{item.label}</strong>
    <a href={V3_EXPLORER+'/address/'+item.address} target="_blank" rel="noreferrer">{item.address} <ExternalLink size={12}/></a></div>
  </div>)}</div>
  <div className="gv3-payment-flow"><b>Withdrawal</b><span>Request</span><span>Manager approval</span><span>Cash reserved</span><span>Paid to your wallet</span></div>
  <small>Withdrawal funds must actually be available or separately supplied. No stage of this map is a payment confirmation.</small>
 </section>;
}

import {formatV3Amount} from './v3-format';
import type {V3WalletPosition} from './v3-chain';

export default function V3UnifiedReinvestSummary({positions}:{positions:V3WalletPosition[]}){
 const total=positions.reduce((sum,position)=>sum+position.availableProfit,0n);
 return <p className="gv2-small">Recorded position profit across all sources: <strong>{formatV3Amount(total)} TEST</strong>.
  {' '}Referral and network rewards are separate.</p>;
}

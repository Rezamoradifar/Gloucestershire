import {rewardBudgetHealth} from './reward-budget';
import {displayAmount} from './money';
import type {Snapshot,Asset} from './chain';
type Funding=Pick<Snapshot,'rewards'|'liquidBalance'|'totalProfit'|'reserve'|'queuedProfit'|'decimals'>;
export default function RewardFundingStatus({data,asset}:{data:Funding;asset:Asset}){
 const health=rewardBudgetHealth(data);
 return <section className="panel" aria-label="Reward funding"><div className="panel-title"><h2>Reward funding</h2></div>
 <div className="plan-detail"><span>Recorded reward budget</span><bdi>{displayAmount(data.rewards,data.decimals)} {asset}</bdi></div>
 <div className="plan-detail"><span>Treasury cash</span><bdi>{displayAmount(data.liquidBalance,data.decimals)} {asset}</bdi></div>
 <div className="plan-detail"><span>Cash available for new profit allocations</span><bdi>{displayAmount(health.available,data.decimals)} {asset}</bdi></div>
 <div className="plan-detail"><span>Reward budget cash shortfall</span><bdi>{displayAmount(health.shortfall,data.decimals)} {asset}</bdi></div>
 {(health.empty||health.shortfall>0n||health.existingProfitShortfall)&&<p role="alert">{health.empty?'The reward budget needs funding. ':''}{health.shortfall>0n?'Return or add treasury cash to cover the recorded reward budget. ':''}{health.existingProfitShortfall?'Cash is also below existing profit and reserve claims.':''}</p>}
 <p className="muted">Reward accounting is separate; treasury cash is shared. Owner capital deployment remains available. Recorded balances do not guarantee payment.</p>
 </section>;
}

export function rewardBudgetHealth(data:{rewards:bigint;liquidBalance:bigint;totalProfit:bigint;reserve:bigint;queuedProfit?:bigint}){
 const pending=data.queuedProfit??0n;
 if([data.rewards,data.liquidBalance,data.totalProfit,data.reserve,pending].some(x=>x<0n))throw Error('Invalid funding balances.');
 const priorClaims=data.totalProfit+data.reserve+pending;
 const available=data.liquidBalance>priorClaims?data.liquidBalance-priorClaims:0n;
 const covered=available<data.rewards?available:data.rewards;
 return {available,covered,shortfall:data.rewards-covered,priorClaims,empty:data.rewards===0n,existingProfitShortfall:data.liquidBalance<priorClaims};
}

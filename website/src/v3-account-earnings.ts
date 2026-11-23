import type {V3Snapshot} from './v3-chain';

export type AccountEarnings={personal:bigint;referral:bigint;network:bigint};
export function availableAccountEarnings(view:Pick<V3Snapshot,'positions'|'referralAvailable'|'networkAvailable'>):AccountEarnings{
 return {
  personal:view.positions.reduce((sum,position)=>sum+position.availableProfit,0n),
  referral:view.referralAvailable,
  network:view.networkAvailable
 };
}
export function totalAccountEarnings(earnings:AccountEarnings){
 return earnings.personal+earnings.referral+earnings.network;
}

// Use posted rewards first so reward-only amounts do not require scanning personal capital lots.
export function allocateAccountEarnings(available:AccountEarnings,amount:bigint):AccountEarnings{
 if(amount<=0n)throw Error('Enter a positive test USDT amount.');
 if(amount>totalAccountEarnings(available))throw Error('The amount exceeds available account earnings.');
 const referral=available.referral<amount?available.referral:amount;
 const remainder=amount-referral;
 const network=available.network<remainder?available.network:remainder;
 return {personal:remainder-network,referral,network};
}

import {feeOf} from './money';

export type WithdrawalSnapshot={profit:bigint;withdrawalLimit:bigint;liquidBalance:bigint;nextWithdrawal:bigint;blockTime:number;fee:bigint};
// A display estimate at the loaded block, never an authorization to send funds.
// The transaction path still re-reads, checks the account/network and simulates.
export function profitAvailability(s:WithdrawalSnapshot){
 const recordedLimit=s.profit<s.withdrawalLimit?s.profit:s.withdrawalLimit;
 const fundedLimit=recordedLimit<s.liquidBalance?recordedLimit:s.liquidBalance;
 const cooling=s.nextWithdrawal>BigInt(s.blockTime);
 const gross=cooling?0n:fundedLimit;
 const fee=feeOf(gross,s.fee);
 return {recordedLimit,fundedLimit,cooling,gross,fee,net:gross-fee};
}

import {profitAvailability} from './account';
import {displayAmount} from './money';
import type {Action,Asset,Snapshot} from './chain';

type BalanceSnapshot=Pick<Snapshot,'profit'|'withdrawalLimit'|'liquidBalance'|'nextWithdrawal'|'blockTime'|'fee'|'walletBalance'|'decimals'>;

export default function OperationBalance({kind,data,asset}:{kind:Action['kind'];data:BalanceSnapshot|null;asset:Asset}){
 const label=kind==='profit'?'Available to withdraw (before fee)':kind==='reinvest'?'Available to reinvest':kind==='ownerWithdraw'?'Treasury cash':'Wallet balance';
 const amount=data?(kind==='profit'?profitAvailability(data).gross:kind==='reinvest'?data.profit:kind==='ownerWithdraw'?data.liquidBalance:data.walletBalance):undefined;
 return <span>{label}: <bdi>{displayAmount(amount,data?.decimals)} {asset}</bdi></span>;
}

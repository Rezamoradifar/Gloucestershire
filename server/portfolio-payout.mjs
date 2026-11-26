import {Interface,getAddress} from 'ethers';

const events=new Interface([
  'event WithdrawalPaid(uint256 indexed id,address indexed beneficiary,uint256 net,uint256 fee)',
  'event Transfer(address indexed from,address indexed to,uint256 value)'
]);
export const paidTopic=events.getEvent('WithdrawalPaid').topicHash;
const transferTopic=events.getEvent('Transfer').topicHash;

// A vault event and the token movements must belong to the same successful receipt.
export function verifyPortfolioPayout(receipt,{vault,token,feeReceiver,beneficiary,id,gross,fee}) {
  vault=getAddress(vault); token=getAddress(token); beneficiary=getAddress(beneficiary);
  if(receipt?.status!==1 || gross<=0n || fee<0n || fee>gross)throw Error('Invalid payout receipt');
  const net=gross-fee, expected=[[getAddress(feeReceiver),fee],[beneficiary,net]];
  let paid=0,transfers=[];
  for(const log of receipt.logs){
    const emitter=getAddress(log.address);
    if(emitter===token && log.topics[0]===transferTopic){
      const row=events.decodeEventLog('Transfer',log.data,log.topics);
      if(row.from===vault)transfers.push(row);
    }
    if(emitter!==vault || log.topics[0]!==paidTopic)continue;
    const row=events.decodeEventLog('WithdrawalPaid',log.data,log.topics);
    if(row.id===BigInt(id)){
      if(row.beneficiary!==beneficiary || row.net!==net || row.fee!==fee)throw Error('Payout amount mismatch');
      // The pinned contract transfers the fee, then the net, immediately before WithdrawalPaid.
      const pair=transfers.slice(-2);
      if(pair.length!==2 || expected.some(([to,value],i)=>pair[i].to!==to || pair[i].value!==value))throw Error('Beneficiary or fee transfer missing');
      paid++;
    }
    transfers=[];
  }
  if(paid!==1)throw Error('Payout event missing or duplicated');
}

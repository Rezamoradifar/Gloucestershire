import type {V3TransactionProgress} from './v3-actions';

const actionLabel:Record<V3TransactionProgress['action'],string>={
 registration:'Registration',allowance_reset:'Allowance reset',
 token_approval:'Test-token approval',test_deposit:'Test deposit',network_group:'Reward group',reinvestment:'Reinvestment',withdrawal_request:'Withdrawal request',check_in:'Check-in'
};
const stepLabel:Record<V3TransactionProgress['step'],string>={
 preflight:'Checking the connected wallet and BNB Testnet.',
 simulation:'Checking the transaction and estimating testnet gas.',
 wallet_request:'Sending a request to the wallet. Check the wallet for a prompt.',
 verification:'A transaction reference was received. Checking confirmations.',
 confirmed:'The transaction was confirmed on BNB Testnet.'
};
export function v3TransactionProgressText(detail:V3TransactionProgress){
 return actionLabel[detail.action]+' · '+stepLabel[detail.step];
}

/** Tracks only in-page uncertainty. It is not a persistent transaction journal. */
export class V3TransactionProgressTracker {
 private unresolved=false;
 private last:V3TransactionProgress|null=null;
 record(detail:V3TransactionProgress){
  this.last=detail;
  if(detail.step==='wallet_request')this.unresolved=true;
  if(detail.step==='confirmed')this.unresolved=false;
 }
 needsReview(message:string){
  const declined=message.includes(' was declined in your wallet.');
  return (!declined&&this.unresolved)||
   (this.last?.step==='confirmed'&&(this.last.action==='test_deposit'||this.last.action==='network_group'||this.last.action==='reinvestment'||this.last.action==='withdrawal_request'||this.last.action==='check_in'))||
   message.includes('Check wallet history before retrying.');
 }
}

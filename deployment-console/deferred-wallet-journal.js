export function bindMigrationTransaction(record,transaction){
 if(!transaction||transaction.chainId!==97n||transaction.from.toLowerCase()!==record.from.toLowerCase()||transaction.nonce!==record.nonce||transaction.value!==0n)throw Error('WALLET_TRANSACTION_IDENTITY_MISMATCH');
 return (transaction.to||null)===(record.to||null)&&transaction.data===record.data;
}
export function migrationFeeCommitted(state){
 return Object.values(state.records||{}).reduce((sum,r)=>sum+BigInt(r.actualFee??r.maxFee??0),0n)+
  (state.history||[]).reduce((sum,r)=>sum+BigInt(r.actualFee??r.maxFee??0),0n);
}
export function migrationHasUnresolvedRequest(state){return Object.values(state.records||{}).some(r=>r.uncertain&&!r.hash);}

// Confirmed reversible control calls may be repeated after a later opposite call.
// Keep their fees in history instead of reusing an old successful receipt.
export function archiveConfirmedControl(state,label){
 const record=state.records?.[label];
 if(!record)return;
 if(record.uncertain||!record.hash||record.actualFee===undefined)throw Error('SAVED_CONTROL_REQUEST_REQUIRES_RECOVERY');
 state.history.push(record);delete state.records[label];
}

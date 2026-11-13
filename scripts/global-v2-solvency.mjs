// V2 on-chain-cash coverage, without imaginary operations-wallet assets.
// Amounts MUST be the same token units for one asset; never add USDT to BNB.
export function analyzeV2Liquidity({
 principalLiability,profitLiability,vaultCash
}){
 for(const value of [principalLiability,profitLiability,vaultCash])
  if(typeof value!=='bigint'||value<0n)throw Error('V2_SOLVENCY_BAD_INPUT');
 const total=principalLiability+profitLiability;
 const profitShortfall=profitLiability>vaultCash?profitLiability-vaultCash:0n;
 const availableForPrincipal=vaultCash>profitLiability?vaultCash-profitLiability:0n;
 const principalShortfall=principalLiability>availableForPrincipal?
   principalLiability-availableForPrincipal:0n;
 const combinedShortfall=total>vaultCash?total-vaultCash:0n;
 if(combinedShortfall!==profitShortfall+principalShortfall)
  throw Error('V2_SOLVENCY_INTERNAL_MISMATCH');
 return Object.freeze({
  principalLiability,profitLiability,vaultCash,total,
  profitShortfall,principalShortfall,combinedShortfall,
  availableForPrincipal,
  coverageBps:total?vaultCash*10_000n/total:null,
  status:total===0n?'NO_RECORDED_LIABILITIES':
   combinedShortfall>0n?'VAULT_CASH_INSUFFICIENT':'VAULT_CASH_COVERS_RECORDED_LIABILITIES_AT_BLOCK',
  // Cash coverage alone is not an independent financial audit or solvency
  // guarantee, and this calculation knows nothing of the operations wallet.
  independentAudit:false,
  operationsWalletCountedAsCash:false
 });
}

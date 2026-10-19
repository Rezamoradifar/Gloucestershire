export function selectWalletProvider(scope) {
 const candidates=[scope.safepalProvider,...(Array.isArray(scope.ethereum?.providers)?scope.ethereum.providers:[]).filter(p=>p?.isSafePal),scope.ethereum];
 return candidates.find(p=>typeof p?.request==='function')||null;
}

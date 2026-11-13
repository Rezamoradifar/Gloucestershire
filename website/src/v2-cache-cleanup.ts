// One-time, origin-scoped retirement of browser caches from the OLD Global UI.
// This does not and cannot erase blockchain history, server accounting records,
// wallet application data, third-party cookies or browser HTTP caches.
const MARKER='global-v2-only-browser-cache-v3';
const OLD_PROFILE_PREFIX='global-member-profile-v2:';
const LEGACY_CACHE_PREFIXES=['globaldroptrade','global-legacy','global-old','gdt-'];
export async function clearOldGlobalBrowserCache(){
 let cachesCleared=0,workersUnregistered=0,oldKeysRemoved=0;
 try{
  const c=globalThis.caches;
  if(c){
   const names=await c.keys();
   for(const name of names){
    const key=name.toLowerCase();
    if(LEGACY_CACHE_PREFIXES.some(p=>key.startsWith(p))){
     if(await c.delete(name))cachesCleared++;
    }
   }
  }
 }catch{/* No Cache Storage or browser denied access. */}
 try{
  const sw=globalThis.navigator?.serviceWorker;
  if(sw){
   const registrations=await sw.getRegistrations();
   for(const registration of registrations){
    if(new URL(registration.scope).origin===globalThis.location.origin&&
      await registration.unregister())workersUnregistered++;
   }
  }
 }catch{/* Service worker permission unavailable. */}
 try{
  const storage=globalThis.localStorage;
  const keys=Array.from({length:storage.length},(_,i)=>storage.key(i)).filter((x):x is string=>Boolean(x));
  for(const key of keys){
   if(key.startsWith(OLD_PROFILE_PREFIX)){
    storage.removeItem(key);oldKeysRemoved++;
   }
  }
 }catch{/* Storage unavailable. */}
 return {cachesCleared,workersUnregistered,oldKeysRemoved,
  oldContractLedgerDeleted:false,newV2WalletDataPreserved:true};
}
export async function migrateGlobalV2BrowserOnce(){
 try{
  if(sessionStorage.getItem(MARKER)==='done')return;
  await clearOldGlobalBrowserCache();
  sessionStorage.setItem(MARKER,'done');
 }catch{/* The app remains usable without optional browser caches. */}
}

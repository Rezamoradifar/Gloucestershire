import {clearOldGlobalBrowserCache} from './v2-cache-cleanup';

const MARKER='global-v3-only-browser-cleanup-v1';
// These are the exact app-owned keys from the retired Global profiles and
// notification views. WalletConnect, wallet credentials and preferences are
// outside this scope. Blockchain records are not browser data.
const RETIRED_PREFIXES=[
 'global-member-profile-v2:',
 'global-v2-only-profile:97:',
 'global-notification-view-v2:'
];

export function removeRetiredProfileData(storage:Storage):number{
 const keys=Array.from({length:storage.length},(_,i)=>storage.key(i));
 let removed=0;
 for(const key of keys){
  if(key&&RETIRED_PREFIXES.some(prefix=>key.startsWith(prefix))){
   storage.removeItem(key);removed++;
  }
 }
 return removed;
}

export async function migrateGlobalV3BrowserOnce(){
 try{
  if(sessionStorage.getItem(MARKER)==='done')return;
  // Repeat cache/worker cleanup even if the older release set its own marker.
  await clearOldGlobalBrowserCache();
  removeRetiredProfileData(localStorage);
  sessionStorage.setItem(MARKER,'done');
 }catch{/* Browser storage may be disabled; the app remains usable. */}
}

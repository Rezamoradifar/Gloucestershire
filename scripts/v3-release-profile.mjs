// Fixed, non-overlapping testnet records. No caller-supplied file paths.
export function v3ReleasePaths(value=process.env.GLOBAL_V3_RELEASE_PROFILE){
 if(value===undefined||value==='')return Object.freeze({
  name:'original',proof:'/var/lib/globaldroptrade/v3-prototype/deployment.json',
  keeperConfig:'/etc/globaldroptrade/v3-keeper-testnet.json'
 });
 if(value==='routed-testnet')return Object.freeze({
  name:'routed-testnet',proof:'/var/lib/globaldroptrade/v3-routed-testnet/deployment.json',
  keeperConfig:'/etc/globaldroptrade/v3-routed-keeper-testnet.json'
 });
 throw Error('V3_RELEASE_PROFILE_INVALID');
}

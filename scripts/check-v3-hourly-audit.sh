(
set +e
cd /opt/global-v3-wallet-update/18dc78599cb4677573a5c02f503c39fcc123cd5a || exit 1
case "$(uname -m)" in x86_64) arch=x64;; aarch64) arch=arm64;; *) echo UNSUPPORTED_ARCH; exit 1;; esac
export PATH="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin:$PATH"
echo '=== CONTRACT ==='
if node scripts/verify-v3-hourly-testnet.mjs --check; then
node --input-type=module <<'NODE'
import {Contract,FetchRequest,JsonRpcProvider,formatEther,formatUnits} from 'ethers';
const w='0x63c5B98AEfd69658B652d5F35FFda3C6c06847E3',v='0x4F2777861cc5bDD0d6AED86014cE1370BF823884',t='0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
const a=['function ACCRUAL_PERIOD() view returns(uint256)','function paused() view returns(bool)','function memberCount() view returns(uint256)','function isEligible(address) view returns(bool)','function users(address) view returns(address referrer,bool registered,bool suspended,bool vipKyc,uint64 lastCheckIn,uint64 nextRequestAt,bool pendingRequest,uint256 capital,uint256 originalDeposits,uint256 reinvestments,uint256 referralAvailable,uint256 referralReserved,uint256 cumulativeReferral)','function positionCount(address) view returns(uint256)','function positionOf(address,uint256) view returns(tuple(uint256 principal,uint256 compoundedBasis,uint256 availableProfit,uint256 reservedProfit,uint256 reservedPrincipal,uint256 cumulativeDaily,uint256 cumulativeCompound,uint64 openedAt,uint64 lastAccruedAt,bool fromReinvestment))','function cashStatus() view returns(uint256 cash,uint256 principal,uint256 accruedProfit,uint256 escrowedCash,uint256 totalCashShortfall)'];
let done=false;
for(const url of ['https://bsc-testnet-dataseed.bnbchain.org','https://bsc-testnet-rpc.publicnode.com']){
 const q=new FetchRequest(url);q.timeout=8000;const p=new JsonRpcProvider(q,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
 try{
  if(BigInt(await p.send('eth_chainId',[]))!==97n)throw Error('WRONG_CHAIN');
  const h=await p.getBlockNumber(),b=await p.getBlock(h-3);if(!b?.hash)throw Error('BLOCK_UNAVAILABLE');
  const o={blockTag:b.number},c=new Contract(v,a,p),token=new Contract(t,['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)'],p);
  const [u,n,ok,period,paused,members,cash,bnb,balance,allowance]=await Promise.all([c.users(w,o),c.positionCount(w,o),c.isEligible(w,o),c.ACCRUAL_PERIOD(o),c.paused(o),c.memberCount(o),c.cashStatus(o),p.getBalance(w,b.number),token.balanceOf(w,o),token.allowance(w,v,o)]);
  const count=Number(n);if(!Number.isSafeInteger(count)||count>1000000)throw Error('COUNT_INVALID');
  const positions=[];
  for(let i=0;i<Math.min(count,10);i++){
   const x=await c.positionOf(w,i,o),next=Number(x.lastAccruedAt+period);
   positions.push({id:i,principal:formatUnits(x.principal,18),profit:formatUnits(x.availableProfit,18),daily:formatUnits(x.cumulativeDaily,18),compound:formatUnits(x.cumulativeCompound,18),nextDueUTC:new Date(next*1000).toISOString(),due:x.principal>0n&&b.timestamp>=next});
  }
  const again=await p.getBlock(b.number);if(!again?.hash||again.hash!==b.hash)throw Error('BLOCK_CHANGED');
  console.log('V3_READONLY_STATUS '+JSON.stringify({source:url,chainId:97,contract:v,wallet:w,block:b.number,timeUTC:new Date(b.timestamp*1000).toISOString(),registered:u.registered,eligible:ok,paused,members:String(members),lastCheckInUTC:u.lastCheckIn?new Date(Number(u.lastCheckIn)*1000).toISOString():null,periodSeconds:Number(period),testBNB:formatEther(bnb),testTokenBalance:formatUnits(balance,18),allowanceTest:formatUnits(allowance,18),positionCount:count,positionsShown:positions,cashTest:formatUnits(cash.cash,18),shortfallTest:formatUnits(cash.totalCashShortfall,18)}));done=true;break;
 }catch(e){console.log('V3_READONLY_RPC_ERROR '+url+' '+String(e?.shortMessage||e?.code||e?.message||'unknown').slice(0,100));}finally{p.destroy();}
}
if(!done)process.exitCode=1;
NODE
else echo V3_CONTRACT_VERIFICATION_FAILED; fi
echo '=== TIMERS ==='
for t in global-v3-hourly-compound-keeper-testnet.timer global-v3-hourly-network-volume-testnet.timer; do echo "$t enabled=$(systemctl is-enabled "$t" 2>/dev/null) active=$(systemctl is-active "$t" 2>/dev/null)"; done
echo '=== COMPOUND ==='
journalctl -u global-v3-hourly-compound-keeper-testnet.service -n 40 --no-pager -o cat | grep -E '^V3_(KEEPER_READINESS|AUTO_COMPOUND_RUN_RESULT)' | tail -n 4
echo '=== VOLUME ==='
journalctl -u global-v3-hourly-network-volume-testnet.service -n 40 --no-pager -o cat | grep -E '^V3_VOLUME_(READINESS|PREFLIGHT|CONFIRMED|RESULT)' | tail -n 4
echo '=== COMMERCE ==='
curl -fsS --noproxy '*' --max-time 5 http://127.0.0.1:3115/api/commerce/status || echo COMMERCE_API_UNAVAILABLE
echo
)

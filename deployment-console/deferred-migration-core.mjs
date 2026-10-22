import {Contract,ContractFactory,Interface,AbiCoder,ZeroAddress,getAddress,keccak256,zeroPadValue} from './ethers.js';

export const deferredPolicy={chainId:97,source:'0x731Ba0644e8f44BbBd48124F945724ba534431eb',sourceHash:'0x6efe9551ee99d12a8e8db4844a06ae6e66e79fc424b0cfca426e2528ff2f69b6',creationHash:'0xc0c6823884402867b3c1cbdb5a65d6f311a771c3cb22e4010a4e14d27d129465',owner:'0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632',operator:'0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2'};
export const deferredSourceAbi=[
 'function owner() view returns(address)','function pendingOwner() view returns(address)','function paused() view returns(bool)','function setPaused(bool)',
 'function usdt() view returns(address)','function withdrawalQueue() view returns(address)','function usedRewardBatch(bytes32) view returns(bool)',
 'function ledgers(address) view returns(uint256 principal,uint256 profit,uint256 feeReserve,uint256 rewards)','function assetBalance(address) view returns(uint256)',
 'event Registered(address indexed user,address indexed referrer)','event SaleSettled(bytes32 indexed id,address indexed seller,address indexed asset,uint256 grossProfit,uint256 salesUsd,bytes32 evidenceHash)','event ProfitCredited(address indexed user,address indexed asset,uint256 amount,bytes32 indexed id)'
];
const events=new Interface(deferredSourceAbi),queueAbi=['function vault() view returns(address)','function APPROVAL_VERSION() view returns(uint256)','function requestCount() view returns(uint256)','function pending(address) view returns(uint256)'];
const sortedAddresses=list=>[...new Set(list.map(getAddress))].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);
const sortedIds=list=>[...new Set(list)].sort();
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hex32=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);

export async function guardDeferredSource(provider,policy=deferredPolicy){
 if(Number(await provider.send('eth_chainId',[]))!==97||policy.chainId!==97)throw Error('TESTNET_ONLY');
 if(keccak256(await provider.getCode(policy.source))!==policy.sourceHash)throw Error('SOURCE_RUNTIME_MISMATCH');
 const source=new Contract(policy.source,deferredSourceAbi,provider);
 if(getAddress(await source.owner())!==policy.owner||await source.pendingOwner()!==ZeroAddress)throw Error('SOURCE_OWNERSHIP_MISMATCH');
 return source;
}

// A reviewed event seed avoids scanning years of headers or requiring historical state tries.
// Only logs after the seed checkpoint are read. Account/queue completeness is also enforced by the constructor.
export async function scanDeferredInventory({provider,policy=deferredPolicy,seed,state={},through,throughTransactionIndex,save=()=>{},log=()=>{},maxPages=1000}){
 const receipt=await provider.getTransactionReceipt(policy.creationHash);
 if(!receipt||receipt.status!==1||getAddress(receipt.contractAddress)!==policy.source||(await provider.getBlock(receipt.blockNumber))?.hash!==receipt.blockHash)throw Error('SOURCE_CREATION_MISMATCH');
 through??=Math.max(receipt.blockNumber,(await provider.getBlockNumber())-3);
 const endBlock=await provider.getBlock(through);if(!endBlock)throw Error('SCAN_BLOCK_UNAVAILABLE');
 if(seed){
  if(seed.version!==1||seed.chainId!==97||seed.source!==policy.source||seed.creationHash!==policy.creationHash||seed.creationBlock!==receipt.blockNumber||!Number.isSafeInteger(seed.through)||seed.through<receipt.blockNumber||seed.through>through||!hex32(seed.blockHash))throw Error('INVALID_EVENT_SEED');
  if((await provider.getBlock(seed.through))?.hash!==seed.blockHash)throw Error('EVENT_SEED_REORG');
  if(!equal(seed.members,sortedAddresses(seed.members))||![...seed.settlements,...seed.creditIds].every(hex32))throw Error('INVALID_SEED_CONTENTS');
 }
 const identity=policy.source+':'+policy.creationHash;
 if(state.identity&&state.identity!==identity)throw Error('SCAN_IDENTITY_CHANGED');
 state.identity=identity;
 if(state.through===undefined)Object.assign(state,{through:seed?.through??receipt.blockNumber-1,hash:seed?.blockHash??null,members:seed?.members??[],settlements:seed?.settlements??[],creditIds:seed?.creditIds??[]});
 if(state.through>through)throw Error('SCAN_CHECKPOINT_AFTER_SNAPSHOT');
 if(state.hash&&(await provider.getBlock(state.through))?.hash!==state.hash)throw Error('SCAN_CHECKPOINT_REORG');
 const members=new Set(state.members),settlements=new Set(state.settlements),creditIds=new Set(state.creditIds);
 const topics=['Registered','SaleSettled','ProfitCredited'].map(name=>events.getEvent(name).topicHash);
 let pageSize=5000,pages=0;
 for(let start=state.through+1;start<=through&&pages<maxPages;pages++){
  const end=Math.min(through,start+pageSize-1);let logs;
  try{logs=await provider.getLogs({address:policy.source,fromBlock:start,toBlock:end,topics:[topics]});}
  catch(e){if(pageSize<=20)throw Error('EVENT_HISTORY_UNAVAILABLE');pageSize=Math.max(20,Math.floor(pageSize/2));pages--;continue;}
  for(const entry of logs){
   if(entry.removed||getAddress(entry.address)!==policy.source||entry.blockNumber<start||entry.blockNumber>end)throw Error('INVALID_SOURCE_EVENT');
   if(entry.blockNumber===through&&throughTransactionIndex!==undefined&&entry.transactionIndex>=throughTransactionIndex)continue;
   const event=events.parseLog(entry);
   if(event.name==='Registered')members.add(getAddress(event.args.user));else if(event.name==='SaleSettled')settlements.add(event.args.id);else creditIds.add(event.args.id);
  }
  const block=await provider.getBlock(end);if(!block)throw Error('SCAN_BLOCK_UNAVAILABLE');
  Object.assign(state,{through:end,hash:block.hash,members:sortedAddresses([...members]),settlements:sortedIds([...settlements]),creditIds:sortedIds([...creditIds])});save();
  start=end+1;log('Scanning '+end+' / '+through+'; '+members.size+' users');
 }
 if(state.through<through)return {complete:false,state};
 if((await provider.getBlock(through))?.hash!==endBlock.hash)throw Error('SCAN_REORG');
 const source=new Contract(policy.source,deferredSourceAbi,provider),batches=[];
 for(const id of state.creditIds)if(await source.usedRewardBatch(id))batches.push(id);
 return {complete:true,inventory:{members:state.members,settlements:state.settlements,batches:sortedIds(batches),fromBlock:receipt.blockNumber,block:through,blockHash:endBlock.hash}};
}

export async function assertSourceTreasuryEmpty(source){
 for(const asset of [ZeroAddress,await source.usdt()]){
  const l=await source.ledgers(asset);
  if(await source.assetBalance(asset)!==0n||l.feeReserve!==0n||l.rewards!==0n)throw Error('SOURCE_TREASURY_REQUIRES_REVIEW');
 }
}

// Exact initcode + a successful receipt proves the audited constructor executed its atomic copy.
// This avoids pretending that a pruned RPC can compare historical storage after the fact.
export async function verifyDeferredImport({provider,artifact,hash,seed,policy=deferredPolicy,minConfirmations=4,log=()=>{}}){
 const source=await guardDeferredSource(provider,policy);
 if(!await source.paused())throw Error('SOURCE_MUST_REMAIN_PAUSED');
 const [tx,receipt,head]=await Promise.all([provider.getTransaction(hash),provider.getTransactionReceipt(hash),provider.getBlockNumber()]);
 if(!tx||!receipt||receipt.status!==1||!receipt.contractAddress||tx.to!==null||getAddress(tx.from)!==(policy.migrationDeployer||policy.owner)||tx.chainId!==97n||tx.value!==0n||head-receipt.blockNumber+1<minConfirmations)throw Error('MIGRATION_RECEIPT_MISMATCH');
 if((await provider.getBlock(receipt.blockNumber))?.hash!==receipt.blockHash)throw Error('MIGRATION_RECEIPT_REORG');
 const bytecode=artifact.bytecode||'0x'+artifact.evm.bytecode.object;
 if(!tx.data.startsWith(bytecode))throw Error('MIGRATION_BYTECODE_MISMATCH');
 let args;try{args=AbiCoder.defaultAbiCoder().decode(['address','address[]','bytes32[]','bytes32[]'],'0x'+tx.data.slice(bytecode.length));}catch{throw Error('INVALID_MIGRATION_ARGUMENTS');}
 if(args[0]!==policy.source)throw Error('WRONG_MIGRATION_SOURCE');
 const found=await scanDeferredInventory({provider,policy,seed,through:receipt.blockNumber,throughTransactionIndex:receipt.index,state:{},log});
 if(!found.complete)throw Error('MIGRATION_SCAN_INCOMPLETE');
 const inventory=found.inventory;
 if(!equal(Array.from(args[1]),inventory.members)||!equal(Array.from(args[2]),inventory.settlements)||!equal(Array.from(args[3]),inventory.batches))throw Error('MIGRATION_INVENTORY_MISMATCH');
 const expected=await new ContractFactory(artifact.abi,bytecode).getDeployTransaction(policy.source,inventory.members,inventory.settlements,inventory.batches);
 if(expected.data!==tx.data)throw Error('MIGRATION_ENCODING_MISMATCH');
 const target=new Contract(receipt.contractAddress,artifact.abi,provider),queue=new Contract(await target.withdrawalQueue(),queueAbi,provider);
 if(await target.owner()!==policy.owner||await target.migrationSource()!==policy.source||await target.migrationBlock()!==BigInt(receipt.blockNumber)||await target.REWARD_ACCRUAL_VERSION()!==1n||await queue.APPROVAL_VERSION()!==1n||await queue.vault()!==receipt.contractAddress)throw Error('MIGRATION_TARGET_MISMATCH');
 if((await provider.getBlock(receipt.blockNumber))?.hash!==receipt.blockHash)throw Error('MIGRATION_RECEIPT_REORG');
 return {kind:'deferred-testnet-copy-v1',chainId:97,source:policy.source,sourceRuntimeHash:policy.sourceHash,target:receipt.contractAddress,owner:policy.owner,hash,block:receipt.blockNumber,blockHash:receipt.blockHash,queue:await target.withdrawalQueue(),runtimeHash:keccak256(await provider.getCode(receipt.contractAddress)),artifactHash:keccak256(bytecode),inventory,verified:true,atomicConstructorCopyVerified:true,legacyClaimsExtinguished:false,accountsMigrated:true,siteConnected:false};
}

// Before site cutover, reject any source/legacy-queue mutation since the copied transaction.
export async function assertDeferredSnapshotStable({provider,report,policy=deferredPolicy}){
 const source=await guardDeferredSource(provider,policy);if(!await source.paused())throw Error('SOURCE_REACTIVATED');
 await assertSourceTreasuryEmpty(source);
 const receipt=await provider.getTransactionReceipt(report.hash),queue=await source.withdrawalQueue(),head=await provider.getBlockNumber();
 for(const address of [policy.source,queue]){
  let span=5000;
  for(let start=receipt.blockNumber;start<=head;){
   const end=Math.min(head,start+span-1);let logs;
   try{logs=await provider.getLogs({address,fromBlock:start,toBlock:end});}catch{if(span<=20)throw Error('CUTOVER_HISTORY_UNAVAILABLE');span=Math.max(20,Math.floor(span/2));continue;}
   if(logs.some(l=>l.removed||l.blockNumber>receipt.blockNumber||l.transactionIndex>receipt.index))throw Error('SOURCE_CHANGED_AFTER_COPY');
   start=end+1;
  }
 }
 if((await provider.getBlock(receipt.blockNumber))?.hash!==report.blockHash)throw Error('MIGRATION_RECEIPT_REORG');
 return head;
}

// Discover mined copies by this owner before selecting another nonce, including across browsers.
export async function discoverDeferredCopies({provider,artifact,seed,policy=deferredPolicy,state={},maxPages=100}){
 await guardDeferredSource(provider,policy);
 if(!seed||seed.source!==policy.source||seed.creationHash!==policy.creationHash||(await provider.getBlock(seed.through))?.hash!==seed.blockHash)throw Error('INVALID_EVENT_SEED');
 if(state.through===undefined)Object.assign(state,{through:seed.through,hash:seed.blockHash,copies:[]});
 if((await provider.getBlock(state.through))?.hash!==state.hash)Object.assign(state,{through:seed.through,hash:seed.blockHash,copies:[]});
 const topic=new Interface(['event DeferredStateCopied(address indexed source,address indexed owner)']).getEvent('DeferredStateCopied').topicHash;
 const head=await provider.getBlockNumber(),bytecode=artifact.bytecode||'0x'+artifact.evm.bytecode.object;
 let span=5000,pages=0;
 for(let start=state.through+1;start<=head&&pages<maxPages;pages++){
  const end=Math.min(head,start+span-1);let logs;
  try{logs=await provider.getLogs({fromBlock:start,toBlock:end,topics:[topic,zeroPadValue(policy.source,32),zeroPadValue(policy.owner,32)]});}
  catch{if(span<=20)throw Error('COPY_DISCOVERY_UNAVAILABLE');span=Math.max(20,Math.floor(span/2));pages--;continue;}
  for(const entry of logs){
   if(entry.removed)throw Error('COPY_DISCOVERY_REORG');
   const [tx,receipt]=await Promise.all([provider.getTransaction(entry.transactionHash),provider.getTransactionReceipt(entry.transactionHash)]);
   if(tx?.to===null&&getAddress(tx.from)===(policy.migrationDeployer||policy.owner)&&tx.data.startsWith(bytecode)&&receipt?.status===1&&receipt.contractAddress===getAddress(entry.address)&&!state.copies.some(c=>c.hash===tx.hash))state.copies.push({hash:tx.hash,target:receipt.contractAddress,block:receipt.blockNumber});
  }
  const block=await provider.getBlock(end);if(!block)throw Error('COPY_DISCOVERY_UNAVAILABLE');state.through=end;state.hash=block.hash;start=end+1;
 }
 const copies=[];
 for(const copy of state.copies){
  const target=new Contract(copy.target,artifact.abi,provider);
  copies.push({...copy,paused:await target.paused()});
 }
 return {complete:state.through>=head,through:state.through,copies};
}

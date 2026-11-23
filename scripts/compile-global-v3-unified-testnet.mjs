// Compile-only release guard for the EXPERIMENTAL unified testnet contracts.
// This does not deploy, verify a deployment, migrate accounts or change a site.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import solc from 'solc';

const FILE='contracts/v3/GlobalV3UnifiedTestnet.sol';
const BOOK='contracts/v3/UnifiedReinvestmentBook.sol';
const SINGLE_CAPITAL_FILE='contracts/v3/GlobalV3SingleCapitalTestnet.sol';
const SINGLE_CAPITAL_BOOK='contracts/v3/SingleCapitalBook.sol';
const source=(file)=>fs.readFileSync(file,'utf8');

function replaceOnce(text,before,after){
 const parts=text.split(before);
 if(parts.length!==2)throw Error('V3_SINGLE_CAPITAL_SOURCE_CHANGED: '+before.trim().split('\n')[0]);
 return parts.join(after);
}

// Keep the published vault source byte-for-byte reproducible. As for the
// hourly profile, compile a separate testnet profile from the reviewed base.
// Both additions use the existing grouped ledger, which retains independent
// accrual and principal-lock times and reconciles with the vault totals.
function singleCapitalSources(baseProfitReferrals=false){
 let vault=replaceOnce(source(FILE),'contract GlobalV3UnifiedTestnet is','contract GlobalV3SingleCapitalTestnet is');
 vault=replaceOnce(vault,'import {UnifiedReinvestmentBook} from "./UnifiedReinvestmentBook.sol";',
  'import {SingleCapitalBook} from "./SingleCapitalBook.sol";');
 vault=replaceOnce(vault,'UnifiedReinvestmentBook public immutable reinvestmentBook;',
  'SingleCapitalBook public immutable reinvestmentBook;');
 vault=replaceOnce(vault,'new UnifiedReinvestmentBook(address(this))','new SingleCapitalBook(address(this))');
 vault=replaceOnce(vault,'    uint256 public constant BPS = 10_000;',
  '    uint256 public constant SINGLE_CAPITAL_VERSION = 1;\n    uint256 public constant BPS = 10_000;');
 vault=replaceOnce(vault,`        uint256 id=positions[msg.sender].length;
        positions[msg.sender].push(Position(amount,0,0,0,0,0,0,
            uint64(block.timestamp),uint64(block.timestamp),false));`,
  '        uint256 id=_recordCapitalAddition(msg.sender,amount);');
 vault=replaceOnce(vault,
  'uint256 id=_recordReinvestment(u,group,total);','uint256 id=_recordReinvestment(u,total);');
 vault=replaceOnce(vault,
  'uint256 id=_recordReinvestment(u,group,amount);','uint256 id=_recordReinvestment(u,amount);');
 vault=replaceOnce(vault,`    function _recordReinvestment(User storage u,uint256 group,uint256 amount) private returns(uint256 id) {
        reinvestmentBook.record(msg.sender,amount);
        principalLiability+=amount;
        networkPlan.capitalChanged(msg.sender,u.capital,u.capital+amount);
        u.capital+=amount;
        u.reinvestments+=amount;
        if(group==0){
            id=positions[msg.sender].length;
            positions[msg.sender].push(Position(0,0,0,0,0,0,0,
                uint64(block.timestamp),uint64(block.timestamp),true));
            reinvestmentPositionPlusOne[msg.sender]=id+1;
        }else{id=group-1;}
        positions[msg.sender][id].principal+=amount;
        networkPlan.addVolume(msg.sender,amount);
    }`,`    function _recordReinvestment(User storage u,uint256 amount) private returns(uint256 id) {
        principalLiability+=amount;
        networkPlan.capitalChanged(msg.sender,u.capital,u.capital+amount);
        u.capital+=amount;
        u.reinvestments+=amount;
        id=_recordCapitalAddition(msg.sender,amount);
        networkPlan.addVolume(msg.sender,amount);
    }
    function _recordCapitalAddition(address who,uint256 amount) private returns(uint256) {
        reinvestmentBook.record(who,amount);
        if(reinvestmentPositionPlusOne[who]==0){
            // Reuse the ABI's grouped-position flag for the single account.
            positions[who].push(Position(0,0,0,0,0,0,0,
                uint64(block.timestamp),uint64(block.timestamp),true));
            reinvestmentPositionPlusOne[who]=1;
        }
        positions[who][0].principal+=amount;
        return 0;
    }`);

 let book=replaceOnce(source(BOOK),'contract UnifiedReinvestmentBook {','contract SingleCapitalBook {');
 book=replaceOnce(book,'event ReinvestmentLotAdded(', 'event CapitalAdditionRecorded(');
 book=replaceOnce(book,'emit ReinvestmentLotAdded(', 'emit CapitalAdditionRecorded(');
 book=replaceOnce(book,
  '/// @dev Parent must atomically debit an existing verified claim first.',
  '/// @dev Parent must atomically receive a test deposit or debit a verified claim.');
 if(baseProfitReferrals){
  // Version 1 is live. Keep its creation code reproducible and publish the
  // corrected hourly account under a distinct version and deployment proof.
  vault=replaceOnce(vault,'SINGLE_CAPITAL_VERSION = 1','SINGLE_CAPITAL_VERSION = 3');
  vault=replaceOnce(vault,'_creditReferrals(who,gross);','_creditReferrals(who,personal);');
  vault=replaceOnce(vault,'_creditReferrals(address who,uint256 gross)','_creditReferrals(address who,uint256 personal)');
  vault=replaceOnce(vault,'Math.mulDiv(gross,referralBps','Math.mulDiv(personal,referralBps');
  vault=vault.replaceAll('grosses','personalByLot');
  book=replaceOnce(book,'grossByLot[next-start]=d+c;','grossByLot[next-start]=d;');
  book=book.replaceAll('grossByLot','personalByLot');
  book=replaceOnce(book,'Per-lot grosses allow a future parent to apply referral rounding per lot.',
   'Only profit on principal earns referral commission. Round each mature lot independently.');
 }
 return {[SINGLE_CAPITAL_FILE]:{content:vault},[SINGLE_CAPITAL_BOOK]:{content:book}};
}

// Build V4 from the pinned referral profile without changing the published V1-V3 bytecode.
// The basis still tracks spendable claims for withdrawals, reservations and manual reinvestment.
function manualReinvestSources(){
 const sources=singleCapitalSources(true);
 let vault=replaceOnce(sources[SINGLE_CAPITAL_FILE].content,'SINGLE_CAPITAL_VERSION = 3','SINGLE_CAPITAL_VERSION = 4');
 vault=replaceOnce(vault,'PROFIT_FEE_BPS = 300;','PROFIT_FEE_BPS = 200;');
 vault=replaceOnce(vault,'uint256 compound=Math.mulDiv(p.compoundedBasis,bps,BPS);','uint256 compound=0;');
 sources[SINGLE_CAPITAL_FILE]={content:vault};
 sources[SINGLE_CAPITAL_BOOK]={content:replaceOnce(sources[SINGLE_CAPITAL_BOOK].content,
  'uint256 c=Math.mulDiv(l.basis,bps,BPS);','uint256 c=0;')};

 const planFile='contracts/v3/V3NetworkPlan.sol';
 let plan=replaceOnce(source(planFile),'if(beforeVolume==0) networkBranches[parent].push(child);',
  'if(beforeVolume==0) _assignRewardGroup(parent,child);');
 const begin=plan.indexOf('    /// @notice Disjoint groups');
 const end=plan.indexOf('    function rewardGroupCount(');
 if(begin<0||end<=begin)throw Error('V3_NETWORK_MEMBERSHIP_SOURCE_CHANGED');
 plan=replaceOnce(plan,plan.slice(begin,end),`    uint256 public constant AUTO_REWARD_GROUP_VERSION = 1;
    event RewardBranchAutoAssigned(address indexed user,address indexed branch);

    function _assignRewardGroup(address parent,address child) private {
        networkBranches[parent].push(child);
        RewardGroup[] storage groups=rewardGroups[parent];
        bool create=groups.length==0 || groups[groups.length-1].stage==14;
        if(create) groups.push();
        uint256 index=groups.length-1;
        RewardGroup storage group=groups[index];
        group.branches.push(child);
        group.consumedUsd.push(0);
        groupedBranch[parent][child]=true;
        address[] memory added=new address[](1);
        added[0]=child;
        if(create) emit RewardGroupCreated(parent,index,added);
        else emit RewardBranchesAdded(parent,index,added);
        emit RewardBranchAutoAssigned(parent,child);
    }
`);
 sources[planFile]={content:plan};
 return sources;
}

function compile(sources,vaultFile,vaultName,bookFile,bookName,networkFile='contracts/v3/UnifiedNetworkPlan.sol',networkName='UnifiedNetworkPlan'){
 if(!solc.version().startsWith('0.8.30+commit.73712a01.'))throw Error('GLOBAL_V3_SOLC_0_8_30_REQUIRED');
 const input={language:'Solidity',sources,settings:{
  optimizer:{enabled:true,runs:1},viaIR:true,evmVersion:'shanghai',
  outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}
 }};
 const out=JSON.parse(solc.compile(JSON.stringify(input),{import:name=>{
  try{return {contents:fs.readFileSync(path.resolve(name.startsWith('contracts/')?name:path.join('node_modules',name)),'utf8')};}
  catch{return {error:'Missing import '+name};}
 }}));
 const errors=(out.errors||[]).filter(item=>item.severity==='error');
 if(errors.length)throw Error(errors.map(item=>item.formattedMessage).join('\n'));
 const artifacts={};
 for(const [file,name] of [[vaultFile,vaultName],[networkFile,networkName],[bookFile,bookName]]){
  const a=out.contracts[file]?.[name];
  if(!a?.evm?.bytecode?.object||!a?.evm?.deployedBytecode?.object)throw Error('UNIFIED_COMPONENT_MISSING_'+name);
  const runtimeBytes=a.evm.deployedBytecode.object.length/2,creationBytes=a.evm.bytecode.object.length/2;
  if(runtimeBytes>24576||creationBytes>49152)throw Error('UNIFIED_EVM_SIZE_LIMIT_'+name);
  artifacts[name]=a;
 }
 return Object.freeze(artifacts);
}

export function compileUnifiedTestnet(){
 return compile({[FILE]:{content:source(FILE)}},FILE,'GlobalV3UnifiedTestnet',BOOK,'UnifiedReinvestmentBook');
}

export function compileSingleCapitalTestnet(){
 return compile(singleCapitalSources(),SINGLE_CAPITAL_FILE,'GlobalV3SingleCapitalTestnet',SINGLE_CAPITAL_BOOK,'SingleCapitalBook');
}

export function compileReferralProfitTestnet(){
 return compile(singleCapitalSources(true),SINGLE_CAPITAL_FILE,'GlobalV3SingleCapitalTestnet',SINGLE_CAPITAL_BOOK,'SingleCapitalBook');
}

export function compileManualReinvestTestnet(){
 return compile(manualReinvestSources(),SINGLE_CAPITAL_FILE,'GlobalV3SingleCapitalTestnet',SINGLE_CAPITAL_BOOK,'SingleCapitalBook');
}

function uplineRatesSources(){
 const sources=manualReinvestSources();
 let vault=replaceOnce(sources[SINGLE_CAPITAL_FILE].content,'contract GlobalV3SingleCapitalTestnet is','abstract contract GlobalV3SingleCapitalTestnet is');
 vault=replaceOnce(vault,'SINGLE_CAPITAL_VERSION = 4','SINGLE_CAPITAL_VERSION = 5');
 vault=replaceOnce(vault,'    function _creditReferrals(address who,uint256 personal) private {',
  '    function _uplineRate(address earner,address recipient,uint8 level) internal view virtual returns(uint16);\n\n    function _creditReferrals(address who,uint256 personal) private {');
 vault=replaceOnce(vault,'        uint8 sourceTier=tierOf(who);\n','');
 vault=replaceOnce(vault,'referralBps(sourceTier,i)','_uplineRate(who,parent,i)');
 vault=replaceOnce(vault,'if(amount>0&&isEligible(parent)&&(i!=3||tierOf(parent)==4)){','if(amount>0){');
 sources[SINGLE_CAPITAL_FILE]={content:vault};
 const file='contracts/v3/GlobalV3UplineRatesTestnet.sol';
 sources[file]={content:source(file)};
 return sources;
}

export function compileUplineRatesTestnet(){
 return compile(uplineRatesSources(),'contracts/v3/GlobalV3UplineRatesTestnet.sol','GlobalV3UplineRatesTestnet',SINGLE_CAPITAL_BOOK,'SingleCapitalBook');
}

export function compileAccountReinvestTestnet(){
 const sources=uplineRatesSources();
 let vault=replaceOnce(sources[SINGLE_CAPITAL_FILE].content,'SINGLE_CAPITAL_VERSION = 5','SINGLE_CAPITAL_VERSION = 6');
 vault=replaceOnce(vault,'uint256 limit,uint256 group) private {','uint256 limit,uint256 group) internal {');
 vault=replaceOnce(vault,'_recordReinvestment(User storage u,uint256 amount) private','_recordReinvestment(User storage u,uint256 amount) internal');
 sources[SINGLE_CAPITAL_FILE]={content:vault};
 const file='contracts/v3/GlobalV3AccountReinvestTestnet.sol';
 sources[file]={content:source(file)};
 return compile(sources,file,'GlobalV3AccountReinvestTestnet',SINGLE_CAPITAL_BOOK,'SingleCapitalBook');
}

export function compileDailyCapitalTestnet(){
 const dir='contracts/v3/daily/';
 const vault=dir+'GlobalV3DailyCapitalTestnet.sol';
 return compile({[vault]:{content:source(vault)}},vault,'GlobalV3DailyCapitalTestnet',
  dir+'DailyCapitalBook.sol','DailyCapitalBook',dir+'DailyCapitalNetwork.sol','DailyCapitalNetwork');
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 try{
  const args=process.argv.slice(2);
  const profiles={'--single-capital':compileSingleCapitalTestnet,'--daily-capital':compileDailyCapitalTestnet,'--referral-profit':compileReferralProfitTestnet,'--manual-reinvest':compileManualReinvestTestnet,'--upline-rates':compileUplineRatesTestnet,'--account-reinvest':compileAccountReinvestTestnet};
  if(args.length>1||args.length===1&&!Object.hasOwn(profiles,args[0]))throw Error('INVALID_V3_UNIFIED_COMPILE_ARGUMENT');
  const artifacts=(args.length?profiles[args[0]]:compileUnifiedTestnet)();
  const sizes=Object.fromEntries(Object.entries(artifacts).map(([name,a])=>[name,{
   runtimeBytes:a.evm.deployedBytecode.object.length/2,creationBytes:a.evm.bytecode.object.length/2
  }]));
  console.log('V3_UNIFIED_COMPILE_ONLY_PASS '+JSON.stringify({chainId:97,sizes,deployed:false,siteUpdated:false}));
 }catch(error){console.error('V3_UNIFIED_COMPILE_BLOCKED '+String(error?.message||error));process.exitCode=1;}
}

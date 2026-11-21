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
function singleCapitalSources(){
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
 return {[SINGLE_CAPITAL_FILE]:{content:vault},[SINGLE_CAPITAL_BOOK]:{content:book}};
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

export function compileDailyCapitalTestnet(){
 const dir='contracts/v3/daily/';
 const vault=dir+'GlobalV3DailyCapitalTestnet.sol';
 return compile({[vault]:{content:source(vault)}},vault,'GlobalV3DailyCapitalTestnet',
  dir+'DailyCapitalBook.sol','DailyCapitalBook',dir+'DailyCapitalNetwork.sol','DailyCapitalNetwork');
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 try{
  const args=process.argv.slice(2);
  if(args.length>1||args.length===1&&!['--single-capital','--daily-capital'].includes(args[0]))throw Error('INVALID_V3_UNIFIED_COMPILE_ARGUMENT');
  const artifacts=args[0]==='--daily-capital'?compileDailyCapitalTestnet():args.length?compileSingleCapitalTestnet():compileUnifiedTestnet();
  const sizes=Object.fromEntries(Object.entries(artifacts).map(([name,a])=>[name,{
   runtimeBytes:a.evm.deployedBytecode.object.length/2,creationBytes:a.evm.bytecode.object.length/2
  }]));
  console.log('V3_UNIFIED_COMPILE_ONLY_PASS '+JSON.stringify({chainId:97,sizes,deployed:false,siteUpdated:false}));
 }catch(error){console.error('V3_UNIFIED_COMPILE_BLOCKED '+String(error?.message||error));process.exitCode=1;}
}

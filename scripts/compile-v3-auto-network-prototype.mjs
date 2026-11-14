// Local-only experiment derived from the isolated hourly testnet source.
// This compiler does not deploy, sign, migrate or replace live files.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import solc from 'solc';
import {hourlyV3Source} from './compile-global-v3-hourly-testnet.mjs';
const FILE='contracts/v3/GlobalV3DeferredTestnet.sol';
const insertion=`
    // Registered users start with automatic recording enabled and can disable it.
    // Branch groups are assigned deterministically on direct registration.
    mapping(address => bool) public autoNetworkEnabled;
    event AutoNetworkPermissionChanged(address indexed beneficiary,bool enabled);
    event AutoBranchAssigned(address indexed parent,address indexed branch,uint256 indexed group,uint8 position);

    function setAutoNetworkEnabled(bool enabled) external {
        if(!users[msg.sender].registered) revert NotEligible();
        autoNetworkEnabled[msg.sender]=enabled;
        emit AutoNetworkPermissionChanged(msg.sender,enabled);
    }
    function claimNetworkRewardsFor(address who,uint256 group,uint8 expectedStage,uint8 count) external nonReentrant active {
        if(!autoNetworkEnabled[who]||!isEligible(who)||count==0||uint256(expectedStage)+count>14) revert NotEligible();
        _checkRewardStage(who,group,expectedStage);
        if(rewardGroups[who][group].branches.length!=3) revert NetworkInsufficient();
        uint256 total;
        for(uint256 i=0;i<count;i++) total+=_consumeReward(who,group);
        networkAvailable[who]+=total;
        cumulativeNetwork[who]+=total;
        profitLiability+=total;
        emit NetworkClaimAccrued(who,group,total,count);
    }

`;
function once(source,needle,replacement){
 const parts=source.split(needle);
 if(parts.length!==2)throw Error('AUTO_NETWORK_SOURCE_ANCHOR_CHANGED');
 return parts.join(replacement);
}
export function autoNetworkSource(source){
 let body=hourlyV3Source(source);
 body=once(body,'contract GlobalV3HourlyTestnet is','contract GlobalV3AutoNetworkPrototype is');
 body=once(body,'        users[who].registered=true;',
  '        users[who].registered=true;\n        autoNetworkEnabled[who]=true;\n        emit AutoNetworkPermissionChanged(who,true);');
 const registration='        users[who].referrer=referrer;\n        members.push(who);';
 const automatic=`        users[who].referrer=referrer;
        if(referrer!=address(0)){
            uint256 n=rewardGroups[referrer].length;
            if(n==0||rewardGroups[referrer][n-1].branches.length==3){rewardGroups[referrer].push();n++;}
            RewardGroup storage g=rewardGroups[referrer][n-1];
            g.branches.push(who);
            g.consumedUsd.push(0);
            groupedBranch[referrer][who]=true;
            emit AutoBranchAssigned(referrer,who,n-1,uint8(g.branches.length));
        }
        members.push(who);`;
 body=once(body,registration,automatic);
 body=once(body,
  '        _checkRewardStage(msg.sender,group,expectedStage);\n        _prepareReward(msg.sender,group,steps);',
  '        _checkRewardStage(msg.sender,group,expectedStage);\n        if(rewardGroups[msg.sender][group].branches.length!=3) revert NetworkInsufficient();\n        _prepareReward(msg.sender,group,steps);');
 body=once(body,
  '        _checkRewardStage(msg.sender,group,expectedStage);\n        uint256 total;',
  '        _checkRewardStage(msg.sender,group,expectedStage);\n        if(rewardGroups[msg.sender][group].branches.length!=3) revert NetworkInsufficient();\n        uint256 total;');
 const anchor='    function _beginRequest(address who) private {';
 return once(body,anchor,insertion+anchor);
}
export function automaticGroupSource(source){
 const create=`    function createRewardGroup(address[] calldata branches) external {
        uint256 index=rewardGroups[msg.sender].length;
        rewardGroups[msg.sender].push();
        _appendBranches(msg.sender,index,branches);
        emit RewardGroupCreated(msg.sender,index,branches);
    }`;
 const add=`    function addRewardBranches(uint256 group,address[] calldata branches) external {
        if(group>=rewardGroups[msg.sender].length || rewardGroups[msg.sender][group].stage>=14) revert NetworkInvalid();
        _appendBranches(msg.sender,group,branches);
        emit RewardBranchesAdded(msg.sender,group,branches);
    }`;
 let body=once(source,create,'    function createRewardGroup(address[] calldata) external pure { revert NetworkInvalid(); }');
 body=once(body,add,'    function addRewardBranches(uint256,address[] calldata) external pure { revert NetworkInvalid(); }');
 return body;
}
export function compileAutoNetworkPrototype(){
 if(!solc.version().startsWith('0.8.30+commit.73712a01.'))throw Error('V3_SOLC_VERSION_INVALID');
 const input={language:'Solidity',sources:{[FILE]:{content:autoNetworkSource(fs.readFileSync(FILE,'utf8'))}},
  settings:{optimizer:{enabled:true,runs:1},viaIR:true,evmVersion:'shanghai',
   outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}};
 const out=JSON.parse(solc.compile(JSON.stringify(input),{import:name=>{
  try{
   const source=fs.readFileSync(path.resolve(name.startsWith('contracts/')?name:path.join('node_modules',name)),'utf8');
   return {contents:name==='contracts/v3/V3NetworkPlan.sol'?automaticGroupSource(source):source};
  }
  catch{return {error:'Cannot resolve '+name};}
 }}));
 const errors=(out.errors||[]).filter(x=>x.severity==='error');
 if(errors.length)throw Error(errors.map(x=>x.formattedMessage).join('\n'));
 const result=out.contracts[FILE]?.GlobalV3AutoNetworkPrototype;
 if(!result)throw Error('AUTO_NETWORK_ARTIFACT_MISSING');
 const runtime=result.evm.deployedBytecode.object.length/2,creation=result.evm.bytecode.object.length/2;
 if(runtime>24576||creation>49152)throw Error('AUTO_NETWORK_EVM_SIZE_LIMIT');
 return {...result,compiler:solc.version(),runtimeBytes:runtime,creationBytes:creation,localOnly:true};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 const a=compileAutoNetworkPrototype();
 console.log('AUTO_NETWORK_PROTOTYPE_COMPILE_ONLY '+JSON.stringify({chainId:97,
  runtimeBytes:a.runtimeBytes,creationBytes:a.creationBytes,groupAssignment:'AUTOMATIC_THREES_BY_DIRECT_REGISTRATION',noDeployment:true}));
}

// BLOCKED LOCAL PROTOTYPE. No deployment, signer, real KYC or live integration.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import solc from 'solc';
import {autoNetworkSource,automaticGroupSource} from './compile-v3-auto-network-prototype.mjs';
const FILE='contracts/v3/GlobalV3DeferredTestnet.sol';
function once(source,before,after){
 const parts=source.split(before);
 if(parts.length!==2)throw Error('IDENTITY_PROTOTYPE_SOURCE_ANCHOR_CHANGED');
 return parts.join(after);
}
const identity=`
    // A verifier certifies an exact wallet/referrer relationship. It is not
    // proof of real identity, uniqueness, KYC quality or sponsor consent.
    address public immutable identityVerifier;
    struct IdentityApproval { address referrer; uint64 deadline; }
    mapping(address => IdentityApproval) public identityApproval;
    mapping(address => uint256) public identityNonce;
    event IdentityApproved(address indexed who,address indexed referrer,uint64 deadline,uint256 nonce);
    bytes32 private constant IDENTITY_TYPEHASH=keccak256("GlobalIdentity(address who,address referrer,uint64 deadline,uint256 nonce,uint256 chainId,address contractAddress)");
    uint256 private constant SECP256K1_HALF_ORDER=0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    function submitIdentityApproval(address who,address referrer,uint64 deadline,uint256 nonce,bytes calldata signature) external {
        if(msg.sender!=who||who==address(0)||users[who].registered||deadline<block.timestamp||
           nonce!=identityNonce[who]||signature.length!=65) revert Invalid();
        bytes32 digest=keccak256(abi.encode(IDENTITY_TYPEHASH,who,referrer,deadline,nonce,block.chainid,address(this)));
        bytes32 signedDigest=keccak256(abi.encodePacked("\\x19Ethereum Signed Message:\\n32",digest));
        bytes32 r; bytes32 s; uint8 v;
        assembly {r:=calldataload(signature.offset) s:=calldataload(add(signature.offset,32)) v:=byte(0,calldataload(add(signature.offset,64)))}
        if(uint256(s)>SECP256K1_HALF_ORDER||(v!=27&&v!=28)||ecrecover(signedDigest,v,r,s)!=identityVerifier) revert Invalid();
        identityNonce[who]=nonce+1;
        identityApproval[who]=IdentityApproval(referrer,deadline);
        emit IdentityApproved(who,referrer,deadline,nonce);
    }
`;
export function identityPrototypeSource(source){
 let body=autoNetworkSource(source);
 body=once(body,'contract GlobalV3AutoNetworkPrototype is','contract GlobalV3IdentityPrototype is');
 body=once(body,'    constructor(address manager,address token,address fees) {',
  '    constructor(address manager,address token,address fees,address verifier) {\n        if(verifier==address(0)||verifier==manager) revert Invalid();\n        identityVerifier=verifier;');
 body=once(body,'        users[who].registered=true;',
  '        IdentityApproval memory approval=identityApproval[who];\n        if(approval.deadline==0||approval.deadline<block.timestamp||approval.referrer!=referrer) revert Invalid();\n        delete identityApproval[who];\n        users[who].registered=true;');
 return once(body,'    function _beginRequest(address who) private {',identity+'\n    function _beginRequest(address who) private {');
}
export function compileIdentityPrototype(){
 if(!solc.version().startsWith('0.8.30+commit.73712a01.'))throw Error('V3_SOLC_VERSION_INVALID');
 const input={language:'Solidity',sources:{[FILE]:{content:identityPrototypeSource(fs.readFileSync(FILE,'utf8'))}},
  settings:{optimizer:{enabled:true,runs:1},viaIR:true,evmVersion:'shanghai',
   outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}};
 const out=JSON.parse(solc.compile(JSON.stringify(input),{import:name=>{
  try{const source=fs.readFileSync(path.resolve(name.startsWith('contracts/')?name:path.join('node_modules',name)),'utf8');
   return {contents:name==='contracts/v3/V3NetworkPlan.sol'?automaticGroupSource(source):source};
  }catch{return {error:'Cannot resolve '+name};}
 }}));
 const errors=(out.errors||[]).filter(x=>x.severity==='error');
 if(errors.length)throw Error(errors.map(x=>x.formattedMessage).join('\n'));
 const a=out.contracts[FILE]?.GlobalV3IdentityPrototype;
 if(!a)throw Error('IDENTITY_PROTOTYPE_ARTIFACT_MISSING');
 return {...a,compiler:solc.version(),runtimeBytes:a.evm.deployedBytecode.object.length/2,
  creationBytes:a.evm.bytecode.object.length/2,localOnly:true,blocked:true};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 const a=compileIdentityPrototype();
 console.log('BLOCKED_IDENTITY_PROTOTYPE '+JSON.stringify({runtimeBytes:a.runtimeBytes,
  creationBytes:a.creationBytes,evmRuntimeLimit:24576,deployAllowed:false}));
}
